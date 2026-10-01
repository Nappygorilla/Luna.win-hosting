import http from "node:http";
import { URL } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";
import { initDb, pool, withTransaction } from "./db.mjs";
import {
  hashPassword,
  verifyPassword,
  newSessionToken,
  hashSessionToken,
  encryptSecret,
  decryptSecret,
  hashAgentSecret,
  verifyAgentHmac,
  signAgentPayload
} from "./security.mjs";
import { getPlan, enforcePlanLimits, validateRuntime, PLANS } from "./plans.mjs";
import { createSubscriptionCheckout, createCustomerPortal, cancelSubscriptionAtPeriodEnd } from "./billing.mjs";
import { sendTransactionalEmail } from "./mailer.mjs";

const PORT = Number(process.env.PORT || 8080);
const COOKIE = process.env.SESSION_COOKIE_NAME || "luna_session";
const CSRF_COOKIE = "luna_csrf";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);
const JSON_LIMIT = 1024 * 1024;
const WEB_ORIGIN = process.env.WEB_ORIGIN || process.env.PUBLIC_BASE_URL || "";
const AGENT_BOOTSTRAP_SECRET = process.env.AGENT_BOOTSTRAP_SECRET || "";
const ENABLE_PAID_CHECKOUT = process.env.ENABLE_PAID_CHECKOUT === "true";
const ALLOW_UNPAID_PROVISIONING = process.env.ALLOW_UNPAID_PROVISIONING === "true";

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key) result[key] = decodeURIComponent(value.join("=") || "");
  }
  return result;
}

async function bodyJson(req) {
  const raw = await rawBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
  }
}

async function rawBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function originAllowed(req) {
  if (!WEB_ORIGIN) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(WEB_ORIGIN).origin;
  } catch {
    return false;
  }
}

function cookieFlags(httpOnly = true) {
  const sameSite = process.env.SESSION_COOKIE_SAMESITE || "Lax";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return "; Path=/; SameSite=" + sameSite + secure + (httpOnly ? "; HttpOnly" : "");
}

function setCsrfCookie(res, token) {
  res.setHeader("Set-Cookie", CSRF_COOKIE + "=" + encodeURIComponent(token) + cookieFlags(false));
}

function sessionCookie(res, token, maxAge) {
  res.setHeader(
    "Set-Cookie",
    COOKIE + "=" + encodeURIComponent(token) + cookieFlags(true) + "; Max-Age=" + maxAge
  );
}

async function sessionUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const result = await pool.query(
    "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hashSessionToken(token)]
  );
  return result.rows[0] || null;
}

async function requireUser(req, res) {
  const user = await sessionUser(req);
  if (!user) {
    json(res, 401, { error: "Authentication required" });
    return null;
  }
  return user;
}

function requireOriginAndCsrf(req, res) {
  if (!originAllowed(req)) {
    json(res, 403, { error: "Origin rejected" });
    return false;
  }
  const cookies = parseCookies(req);
  const token = cookies[CSRF_COOKIE];
  const supplied = req.headers["x-csrf-token"];
  if (!token || !supplied || token !== supplied) {
    json(res, 403, { error: "CSRF validation failed" });
    return false;
  }
  return true;
}

async function createSession(userId) {
  const token = newSessionToken();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)",
    [userId, hashSessionToken(token), expires]
  );
  return { token, expires };
}

function serviceView(row) {
  return {
    id: row.id,
    name: row.name,
    plan: row.plan_id,
    runtime: row.runtime,
    status: row.status,
    nodeId: row.node_id,
    resources: {
      ram_mb: row.ram_mb,
      vcpu: row.vcpu,
      storage_gb: row.storage_gb
    }
  };
}

async function audit(userId, serviceId, action, metadata = {}) {
  await pool.query(
    "INSERT INTO audit_log(user_id,service_id,action,metadata) VALUES($1,$2,$3,$4)",
    [userId || null, serviceId || null, action, JSON.stringify(metadata)]
  );
}

async function getServiceForUser(serviceId, userId) {
  const result = await pool.query(
    "SELECT * FROM services WHERE id=$1 AND user_id=$2",
    [serviceId, userId]
  );
  return result.rows[0] || null;
}

async function ensureCsrf(req, res) {
  const cookies = parseCookies(req);
  if (cookies[CSRF_COOKIE]) return cookies[CSRF_COOKIE];
  const token = newSessionToken();
  setCsrfCookie(res, token);
  return token;
}

function verifyStripeSignature(payload, header, secret) {
  const entries = String(header || "")
    .split(",")
    .map(part => part.split("=", 2))
    .filter(pair => pair.length === 2);
  const parts = Object.fromEntries(entries);
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", secret)
    .update(String(timestamp) + "." + payload)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts.v1, "hex"));
  } catch {
    return false;
  }
}

async function serviceEnv(serviceId) {
  const result = await pool.query(
    "SELECT key,encrypted_value FROM service_env WHERE service_id=$1",
    [serviceId]
  );
  return Object.fromEntries(result.rows.map(row => [row.key, decryptSecret(row.encrypted_value)]));
}

async function assignJob(serviceId, action, payload = {}) {
  const result = await pool.query(
    "INSERT INTO jobs(service_id,action,payload) VALUES($1,$2,$3) RETURNING id",
    [serviceId, action, JSON.stringify(payload)]
  );
  return result.rows[0].id;
}

async function issueToken(table, userId, minutes) {
  const token = newSessionToken();
  await pool.query("DELETE FROM " + table + " WHERE user_id=$1 AND used_at IS NULL", [userId]);
  await pool.query(
    "INSERT INTO " + table + "(user_id,token_hash,expires_at) VALUES($1,$2,now()+($3 || ' minutes')::interval)",
    [userId, hashSessionToken(token), String(minutes)]
  );
  return token;
}

async function sendVerificationEmail(user) {
  const token = await issueToken("email_verification_tokens", user.id, Number(process.env.EMAIL_TOKEN_TTL_MINUTES || 30));
  const base = process.env.PUBLIC_BASE_URL || "";
  const path = process.env.VERIFY_EMAIL_PATH || "/auth.html?mode=verify";
  const url = base + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  return sendTransactionalEmail({ to: user.email, subject: "Verify your Luna Hosting email", text: "Verify your Luna Hosting account: " + url });
}

async function sendPasswordResetEmail(user) {
  const token = await issueToken("password_reset_tokens", user.id, Number(process.env.RESET_TOKEN_TTL_MINUTES || 30));
  const base = process.env.PUBLIC_BASE_URL || "";
  const path = process.env.RESET_PASSWORD_PATH || "/auth.html?mode=reset";
  const url = base + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  return sendTransactionalEmail({ to: user.email, subject: "Reset your Luna Hosting password", text: "Reset your Luna Hosting password: " + url });
}

async function processStripeEvent(event) {
  const type = event && event.type;
  const object = event && event.data && event.data.object;
  if (!object) return;

  if (type === "checkout.session.completed") {
    const metadata = object.metadata || {};
    const orderId = metadata.order_id;
    const userId = metadata.user_id;
    const planId = metadata.plan_id;
    if (!orderId || !userId || !getPlan(planId)) return;

    await withTransaction(async client => {
      await client.query(
        "UPDATE orders SET status='paid',updated_at=now() WHERE id=$1 AND user_id=$2",
        [orderId, userId]
      );
      await client.query(
        "INSERT INTO subscriptions(user_id,plan_id,provider,provider_customer_id,provider_subscription_id,status) " +
        "VALUES($1,$2,'stripe',$3,$4,'active') " +
        "ON CONFLICT(provider_subscription_id) DO UPDATE SET status='active',updated_at=now()",
        [userId, planId, object.customer || null, object.subscription || null]
      );

      const serviceExists = await client.query(
        "SELECT id FROM services WHERE user_id=$1 AND plan_id=$2 AND status IN ('provisioning','running','stopped','starting') LIMIT 1",
        [userId, planId]
      );
      if (!serviceExists.rows[0]) {
        const plan = getPlan(planId);
        const service = await client.query(
          "INSERT INTO services(user_id,plan_id,name,runtime,status,ram_mb,vcpu,storage_gb) " +
          "VALUES($1,$2,$3,$4,'provisioning',$5,$6,$7) RETURNING id",
          [userId, planId, "discord-bot", "nodejs", plan.ramMb, plan.vcpu, plan.storageGb]
        );
        await client.query(
          "INSERT INTO jobs(service_id,action,payload) VALUES($1,'provision',$2)",
          [service.rows[0].id, JSON.stringify({ planId, runtime: "nodejs", resources: { ramMb: plan.ramMb, vcpu: plan.vcpu, storageGb: plan.storageGb } })]
        );
      }
    });
    return;
  }

  if (type === "customer.subscription.deleted" || type === "customer.subscription.updated") {
    const status = object.status || "canceled";
    await pool.query(
      "UPDATE subscriptions SET status=$1,current_period_end=CASE WHEN $2::bigint IS NULL THEN current_period_end ELSE to_timestamp($2::bigint) END,updated_at=now() WHERE provider_subscription_id=$3",
      [status, object.current_period_end ?? null, object.id]
    );
    if (status === "canceled" || status === "unpaid") {
      await pool.query(
        "UPDATE services s SET status='suspended',updated_at=now() WHERE s.user_id IN " +
        "(SELECT user_id FROM subscriptions WHERE provider_subscription_id=$1) AND s.status NOT IN ('deleted','suspended')",
        [object.id]
      );
    }
  }
}

async function route(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    const headers = {
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, X-Agent-Id, X-Agent-Timestamp, X-Agent-Signature",
      "Access-Control-Allow-Credentials": "true"
    };
    if (WEB_ORIGIN) headers["Access-Control-Allow-Origin"] = WEB_ORIGIN;
    res.writeHead(204, headers);
    return res.end();
  }

  if (WEB_ORIGIN && req.headers.origin) res.setHeader("Access-Control-Allow-Origin", WEB_ORIGIN);
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (path === "/health" && req.method === "GET") {
    await ensureCsrf(req, res);
    return json(res, 200, { ok: true, service: "luna-api" });
  }

  if (path === "/v1/auth/csrf" && req.method === "GET") {
    const token = await ensureCsrf(req, res);
    return json(res, 200, { csrfToken: token });
  }

  if (path === "/v1/auth/register" && req.method === "POST") {
    if (!originAllowed(req)) return json(res, 403, { error: "Origin rejected" });
    const input = await bodyJson(req);
    const email = String(input.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "Valid email required" });
    let passwordHash;
    try {
      passwordHash = await hashPassword(String(input.password || ""));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    try {
      const result = await pool.query(
        "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,email_verified_at",
        [email, passwordHash]
      );
      const session = await createSession(result.rows[0].id);
      sessionCookie(res, session.token, SESSION_TTL_DAYS * 86400);
      try { await sendVerificationEmail(result.rows[0]); } catch (error) { console.error("verification email:", error.message); }
      return json(res, 201, { user: result.rows[0], emailVerified: false });
    } catch (error) {
      if (error.code === "23505") return json(res, 409, { error: "Account already exists" });
      throw error;
    }
  }

  if (path === "/v1/auth/login" && req.method === "POST") {
    if (!originAllowed(req)) return json(res, 403, { error: "Origin rejected" });
    const input = await bodyJson(req);
    const email = String(input.email || "").trim().toLowerCase();
    const result = await pool.query(
      "SELECT id,email,password_hash,email_verified_at FROM users WHERE email=$1",
      [email]
    );
    if (!result.rows[0] || !(await verifyPassword(String(input.password || ""), result.rows[0].password_hash))) {
      return json(res, 401, { error: "Invalid credentials" });
    }
    const session = await createSession(result.rows[0].id);
    sessionCookie(res, session.token, SESSION_TTL_DAYS * 86400);
    return json(res, 200, { user: { id: result.rows[0].id, email: result.rows[0].email, emailVerified: Boolean(result.rows[0].email_verified_at) } });
  }

  if (path === "/v1/auth/verify-email" && req.method === "POST") {
    const input = await bodyJson(req);
    const token = String(input.token || "");
    const result = await pool.query("SELECT id,user_id FROM email_verification_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()", [hashSessionToken(token)]);
    if (!result.rows[0]) return json(res, 400, { error: "Invalid or expired verification token" });
    await withTransaction(async client => {
      await client.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [result.rows[0].user_id]);
      await client.query("UPDATE email_verification_tokens SET used_at=now() WHERE id=$1", [result.rows[0].id]);
    });
    return json(res, 200, { verified: true });
  }

  if (path === "/v1/auth/resend-verification" && req.method === "POST") {
    const user = await requireUser(req, res); if (!user) return;
    if (!requireOriginAndCsrf(req, res)) return;
    const result = await pool.query("SELECT id,email,email_verified_at FROM users WHERE id=$1", [user.id]);
    if (result.rows[0]?.email_verified_at) return json(res, 200, { sent: false, verified: true });
    try { await sendVerificationEmail(result.rows[0]); } catch { return json(res, 503, { error: "Verification email is unavailable" }); }
    return json(res, 200, { sent: true });
  }

  if (path === "/v1/auth/request-password-reset" && req.method === "POST") {
    if (!originAllowed(req)) return json(res, 403, { error: "Origin rejected" });
    const input = await bodyJson(req);
    const email = String(input.email || "").trim().toLowerCase();
    const result = await pool.query("SELECT id,email FROM users WHERE email=$1", [email]);
    if (result.rows[0]) {
      try { await sendPasswordResetEmail(result.rows[0]); } catch (error) { console.error("password reset email:", error.message); }
    }
    return json(res, 200, { sent: true });
  }

  if (path === "/v1/auth/reset-password" && req.method === "POST") {
    if (!originAllowed(req)) return json(res, 403, { error: "Origin rejected" });
    const input = await bodyJson(req);
    const token = String(input.token || "");
    let passwordHash;
    try { passwordHash = await hashPassword(String(input.password || "")); } catch (error) { return json(res, 400, { error: error.message }); }
    const result = await pool.query("SELECT id,user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()", [hashSessionToken(token)]);
    if (!result.rows[0]) return json(res, 400, { error: "Invalid or expired reset token" });
    await withTransaction(async client => {
      await client.query("UPDATE users SET password_hash=$2 WHERE id=$1", [result.rows[0].user_id, passwordHash]);
      await client.query("UPDATE password_reset_tokens SET used_at=now() WHERE id=$1", [result.rows[0].id]);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [result.rows[0].user_id]);
    });
    return json(res, 200, { reset: true });
  }

  if (path === "/v1/auth/logout" && req.method === "POST") {
    if (!requireOriginAndCsrf(req, res)) return;
    const token = parseCookies(req)[COOKIE];
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [hashSessionToken(token)]);
    res.setHeader("Set-Cookie", [
      COOKIE + "=; Max-Age=0" + cookieFlags(true),
      CSRF_COOKIE + "=; Max-Age=0" + cookieFlags(false)
    ]);
    return json(res, 200, { ok: true });
  }

  if (path === "/v1/account" && req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    const account = await pool.query(
      "SELECT id,email,email_verified_at,created_at FROM users WHERE id=$1",
      [user.id]
    );
    return json(res, 200, { user: {
      id: account.rows[0].id,
      email: account.rows[0].email,
      emailVerified: Boolean(account.rows[0].email_verified_at),
      createdAt: account.rows[0].created_at
    }});
  }

  if (path === "/v1/billing/subscription" && req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    const result = await pool.query(
      "SELECT plan_id,status,current_period_end,provider_customer_id,provider_subscription_id FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [user.id]
    );
    return json(res, 200, { subscription: result.rows[0] || null });
  }

  if (path === "/v1/plans" && req.method === "GET") {
    return json(res, 200, {
      plans: Object.values(PLANS).map(plan => ({
        id: plan.id,
        name: plan.name,
        price_monthly_cents: plan.priceMonthlyCents,
        ram_mb: plan.ramMb,
        vcpu: plan.vcpu,
        storage_gb: plan.storageGb,
        runtime_families: plan.runtimeFamilies
      }))
    });
  }

  if (path === "/v1/services" && req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    const result = await pool.query(
      "SELECT * FROM services WHERE user_id=$1 ORDER BY created_at DESC",
      [user.id]
    );
    return json(res, 200, { services: result.rows.map(serviceView) });
  }

  if (path === "/v1/services" && req.method === "POST") {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!requireOriginAndCsrf(req, res)) return;
    if (!ENABLE_PAID_CHECKOUT && !ALLOW_UNPAID_PROVISIONING) {
      return json(res, 503, { error: "Provisioning is disabled until billing is configured" });
    }

    const input = await bodyJson(req);
    const plan = getPlan(input.plan);
    if (!plan) return json(res, 400, { error: "Unknown plan" });

    const runtime = String(input.runtime || "nodejs").toLowerCase();
    try {
      validateRuntime(plan, runtime);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    let limits;
    try {
      limits = enforcePlanLimits(plan, input.resources || {});
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    const name = String(input.name || "discord-bot").trim().slice(0, 64);
    if (!name) return json(res, 400, { error: "Service name required" });

    if (ENABLE_PAID_CHECKOUT) {
      const subscription = await pool.query(
        "SELECT id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND plan_id=$2 LIMIT 1",
        [user.id, plan.id]
      );
      if (!subscription.rows[0]) return json(res, 402, { error: "Active subscription required" });
    }

    const service = await withTransaction(async client => {
      const created = await client.query(
        "INSERT INTO services(user_id,plan_id,name,runtime,status,ram_mb,vcpu,storage_gb) " +
        "VALUES($1,$2,$3,$4,'provisioning',$5,$6,$7) RETURNING *",
        [user.id, plan.id, name, runtime, limits.ramMb, limits.vcpu, limits.storageGb]
      );
      await client.query(
        "INSERT INTO jobs(service_id,action,payload) VALUES($1,'provision',$2)",
        [created.rows[0].id, JSON.stringify({ planId: plan.id, runtime, resources: limits })]
      );
      return created.rows[0];
    });
    await audit(user.id, service.id, "service.provision_requested", { plan: plan.id });
    return json(res, 201, { service: serviceView(service) });
  }

  const serviceMatch = path.match(/^\/v1\/services\/([^/]+)$/);
  if (serviceMatch && req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    const service = await getServiceForUser(serviceMatch[1], user.id);
    if (!service) return json(res, 404, { error: "Service not found" });
    return json(res, 200, { service: serviceView(service) });
  }

  const actionMatch = path.match(/^\/v1\/services\/([^/]+)\/actions\/(start|stop|restart|logs)$/);
  if (actionMatch && req.method === "POST") {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!requireOriginAndCsrf(req, res)) return;
    const service = await getServiceForUser(actionMatch[1], user.id);
    if (!service) return json(res, 404, { error: "Service not found" });
    const action = actionMatch[2];
    await assignJob(service.id, action, {});
    if (action !== "logs") {
      await pool.query(
        "UPDATE services SET status=$2,updated_at=now() WHERE id=$1",
        [service.id, action === "start" ? "starting" : action === "stop" ? "stopping" : "restarting"]
      );
    }
    await audit(user.id, service.id, "service." + action);
    return json(res, 202, { accepted: true, status: action });
  }

  const logsRoute = path.match(/^\/v1\/services\/([^/]+)\/logs$/);
  if (logsRoute && req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    const service = await getServiceForUser(logsRoute[1], user.id);
    if (!service) return json(res, 404, { error: "Service not found" });
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
    const result = await pool.query(
      "SELECT id,source,content,created_at FROM service_logs WHERE service_id=$1 ORDER BY id DESC LIMIT $2",
      [service.id, limit]
    );
    return json(res, 200, { logs: result.rows.reverse() });
  }

  const envMatch = path.match(/^\/v1\/services\/([^/]+)\/env$/);
  if (envMatch && req.method === "PUT") {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!requireOriginAndCsrf(req, res)) return;
    const service = await getServiceForUser(envMatch[1], user.id);
    if (!service) return json(res, 404, { error: "Service not found" });

    const input = await bodyJson(req);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json(res, 400, { error: "Environment object required" });
    }

    const entries = Object.entries(input);
    if (entries.length > 50) return json(res, 400, { error: "Too many environment variables" });

    for (const [key, value] of entries) {
      if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) return json(res, 400, { error: "Invalid environment key" });
      if (typeof value !== "string" || value.length > 8192) return json(res, 400, { error: "Invalid environment value" });
      await pool.query(
        "INSERT INTO service_env(service_id,key,encrypted_value) VALUES($1,$2,$3) " +
        "ON CONFLICT(service_id,key) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,updated_at=now()",
        [service.id, key, encryptSecret(value)]
      );
    }
    await audit(user.id, service.id, "service.env_updated", { keys: entries.map(item => item[0]) });
    return json(res, 200, { ok: true, keys: entries.map(item => item[0]) });
  }

  if (path === "/v1/billing/checkout" && req.method === "POST") {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!requireOriginAndCsrf(req, res)) return;
    const verified = await pool.query("SELECT email_verified_at FROM users WHERE id=$1", [user.id]);
    if (!verified.rows[0]?.email_verified_at) return json(res, 403, { error: "Email verification required" });
    const input = await bodyJson(req);
    const plan = getPlan(input.plan);
    if (!plan) return json(res, 400, { error: "Unknown plan" });

    const order = await pool.query(
      "INSERT INTO orders(user_id,plan_id) VALUES($1,$2) RETURNING id",
      [user.id, plan.id]
    );

    try {
      const session = await createSubscriptionCheckout({
        userId: user.id,
        email: user.email,
        planId: plan.id,
        orderId: order.rows[0].id
      });
      await pool.query(
        "UPDATE orders SET provider_session_id=$2,status='checkout_created',updated_at=now() WHERE id=$1",
        [order.rows[0].id, session.id]
      );
      await audit(user.id, null, "billing.checkout_created", { plan: plan.id, orderId: order.rows[0].id });
      return json(res, 200, { url: session.url, orderId: order.rows[0].id });
    } catch (error) {
      await pool.query(
        "UPDATE orders SET status='failed',updated_at=now() WHERE id=$1",
        [order.rows[0].id]
      );
      return json(res, error.code === "CHECKOUT_DISABLED" ? 503 : (error.statusCode || 502), { error: error.message });
    }
  }

  if (path === "/v1/billing/portal" && req.method === "POST") {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!requireOriginAndCsrf(req, res)) return;
    const result = await pool.query(
      "SELECT provider_customer_id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing','past_due') AND provider_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [user.id]
    );
    if (!result.rows[0]) return json(res, 404, { error: "No managed billing account found" });
    try {
      const portal = await createCustomerPortal({ customerId: result.rows[0].provider_customer_id });
      return json(res, 200, { url: portal.url });
    } catch (error) {
      return json(res, 502, { error: error.message });
    }
  }

  if (path === "/v1/billing/cancel" && req.method === "POST") {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!requireOriginAndCsrf(req, res)) return;
    const result = await pool.query(
      "SELECT provider_subscription_id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing','past_due') AND provider_subscription_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [user.id]
    );
    if (!result.rows[0]) return json(res, 404, { error: "No active subscription found" });
    try {
      const updated = await cancelSubscriptionAtPeriodEnd({ subscriptionId: result.rows[0].provider_subscription_id });
      await audit(user.id, null, "billing.cancellation_requested", { subscriptionId: result.rows[0].provider_subscription_id });
      return json(res, 200, { cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end) });
    } catch (error) {
      return json(res, 502, { error: error.message });
    }
  }

  if (path === "/v1/webhooks/stripe" && req.method === "POST") {
    const payload = await rawBody(req);
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
    if (!secret || !verifyStripeSignature(payload, req.headers["stripe-signature"], secret)) {
      return json(res, 400, { error: "Invalid webhook signature" });
    }
    let event;
    try { event = JSON.parse(payload); }
    catch { return json(res, 400, { error: "Invalid webhook payload" }); }
    await processStripeEvent(event);
    return json(res, 200, { received: true });
  }

  if (path === "/v1/internal/agent/register" && req.method === "POST") {
    const bootstrap = req.headers["x-agent-bootstrap"];
    if (!AGENT_BOOTSTRAP_SECRET || String(bootstrap || "") !== AGENT_BOOTSTRAP_SECRET) {
      return json(res, 401, { error: "Agent bootstrap rejected" });
    }
    const input = await bodyJson(req);
    const id = String(input.id || "").trim();
    const name = String(input.name || id).trim().slice(0, 80);
    const secret = String(input.secret || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(id) || secret.length < 32) {
      return json(res, 400, { error: "Valid agent id and 32+ character secret required" });
    }
    await pool.query(
      "INSERT INTO agents(id,name,secret_hash,encrypted_secret,node_capacity,last_seen_at) VALUES($1,$2,$3,$4,$5,now()) " +
      "ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,secret_hash=EXCLUDED.secret_hash,encrypted_secret=EXCLUDED.encrypted_secret,node_capacity=EXCLUDED.node_capacity,last_seen_at=now()",
      [id, name, hashAgentSecret(secret), encryptSecret(secret), JSON.stringify(input.capacity || {})]
    );
    return json(res, 201, { id, registered: true });
  }

  if (path === "/v1/internal/agent/heartbeat" && req.method === "POST") {
    const payload = await rawBody(req);
    const agentId = String(req.headers["x-agent-id"] || "");
    const timestamp = String(req.headers["x-agent-timestamp"] || "");
    const signature = String(req.headers["x-agent-signature"] || "");
    const agent = await pool.query("SELECT encrypted_secret FROM agents WHERE id=$1", [agentId]);
    if (!agent.rows[0]?.encrypted_secret) return json(res, 401, { error: "Agent authentication failed" });
    let secret;
    try { secret = decryptSecret(agent.rows[0].encrypted_secret); } catch { return json(res, 401, { error: "Agent authentication failed" }); }
    if (!verifyAgentHmac(secret, timestamp, payload, signature)) return json(res, 401, { error: "Agent authentication failed" });
    await pool.query("UPDATE agents SET last_seen_at=now() WHERE id=$1", [agentId]);
    return json(res, 200, { ok: true });
  }

  if (path === "/v1/internal/agent/jobs/claim" && req.method === "POST") {
    const payload = await rawBody(req);
    const agentId = String(req.headers["x-agent-id"] || "");
    const timestamp = String(req.headers["x-agent-timestamp"] || "");
    const signature = String(req.headers["x-agent-signature"] || "");
    const agent = await pool.query("SELECT encrypted_secret FROM agents WHERE id=$1", [agentId]);
    if (!agent.rows[0]?.encrypted_secret) return json(res, 401, { error: "Agent authentication failed" });
    let secret;
    try { secret = decryptSecret(agent.rows[0].encrypted_secret); } catch { return json(res, 401, { error: "Agent authentication failed" }); }
    if (!verifyAgentHmac(secret, timestamp, payload, signature)) return json(res, 401, { error: "Agent authentication failed" });

    const job = await withTransaction(async client => {
      const locked = await client.query(
        "SELECT j.*,s.plan_id,s.name,s.runtime,s.ram_mb,s.vcpu,s.storage_gb " +
        "FROM jobs j JOIN services s ON s.id=j.service_id " +
        "WHERE j.status='queued' AND j.available_at<=now() AND (j.agent_id IS NULL OR j.agent_id=$1) " +
        "ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        [agentId]
      );
      if (!locked.rows[0]) return null;
      const row = locked.rows[0];
      const env = await client.query(
        "SELECT key,encrypted_value FROM service_env WHERE service_id=$1",
        [row.service_id]
      );
      const secrets = Object.fromEntries(env.rows.map(item => [item.key, decryptSecret(item.encrypted_value)]));
      const plan = getPlan(row.plan_id);
      const limits = enforcePlanLimits(plan, { ramMb: row.ram_mb, vcpu: row.vcpu, storageGb: row.storage_gb });
      validateRuntime(plan, row.runtime);
      const jobPayload = {
        id: row.id,
        action: row.action,
        service: {
          id: row.service_id,
          name: row.name,
          planId: row.plan_id,
          runtime: row.runtime,
          ramMb: limits.ramMb,
          vcpu: limits.vcpu,
          storageGb: limits.storageGb,
          image: row.runtime === "python" ? process.env.BOT_IMAGE_PYTHON : process.env.BOT_IMAGE_NODEJS
        },
        env: row.action === "provision" ? secrets : {}
      };
      await client.query(
        "UPDATE jobs SET agent_id=$2,status='running',locked_at=now(),attempts=attempts+1 WHERE id=$1",
        [row.id, agentId]
      );
      return jobPayload;
    });

    if (!job) { res.writeHead(204); return res.end(); }
    const body = JSON.stringify(job);
    const signed = signAgentPayload(secret, body);
    return json(res, 200, { job, signature: signed });
  }

  if (path === "/v1/internal/agent/jobs/result" && req.method === "POST") {
    const requestBody = await bodyJson(req);
    const body = JSON.stringify(requestBody);
    const agentId = String(req.headers["x-agent-id"] || "");
    const timestamp = String(req.headers["x-agent-timestamp"] || "");
    const signature = String(req.headers["x-agent-signature"] || "");
    const agent = await pool.query("SELECT encrypted_secret FROM agents WHERE id=$1", [agentId]);
    if (!agent.rows[0]?.encrypted_secret) return json(res, 401, { error: "Agent authentication failed" });
    let secret;
    try { secret = decryptSecret(agent.rows[0].encrypted_secret); } catch { return json(res, 401, { error: "Agent authentication failed" }); }
    if (!verifyAgentHmac(secret, timestamp, body, signature)) return json(res, 401, { error: "Agent authentication failed" });
    const jobId = String(requestBody.jobId || "");
    const ok = Boolean(requestBody.ok);
    await pool.query(
      "UPDATE jobs SET status=$2,completed_at=CASE WHEN $3 THEN now() ELSE completed_at END,last_error=$4 WHERE id=$1 AND agent_id=$5",
      [jobId, ok ? "completed" : "failed", ok, ok ? null : String(requestBody.error || "Agent execution failed").slice(0, 1000), agentId]
    );
    if (requestBody.serviceId) {
      await pool.query(
        "UPDATE services SET status=$2,container_id=COALESCE($3,container_id),node_id=$4,updated_at=now() WHERE id=$1",
        [requestBody.serviceId, ok ? (requestBody.status || "running") : "error", requestBody.containerId || null, agentId]
      );
      if (typeof requestBody.logs === "string" && requestBody.logs.length) {
        await pool.query(
          "INSERT INTO service_logs(service_id,source,content) VALUES($1,'agent',$2)",
          [requestBody.serviceId, requestBody.logs.slice(-200000)]
        );
        await pool.query(
          "DELETE FROM service_logs WHERE service_id=$1 AND id NOT IN (SELECT id FROM service_logs WHERE service_id=$1 ORDER BY id DESC LIMIT 1000)",
          [requestBody.serviceId]
        );
      }
    }
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found" });
}

async function start() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.SECRETS_ENCRYPTION_KEY) throw new Error("SECRETS_ENCRYPTION_KEY is required");
  await initDb();
  const server = http.createServer((req, res) => {
    route(req, res).catch(error => {
      console.error(error);
      json(res, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Internal server error"
      });
    });
  });
  server.listen(PORT, () => console.log("Luna API listening on :" + PORT));
}

if (process.env.NODE_ENV !== "test") start();

export {
  route,
  verifyStripeSignature,
  processStripeEvent
};
