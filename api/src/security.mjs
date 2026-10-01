import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

function encryptionKey() {
  const raw = process.env.SECRETS_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("SECRETS_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters");
  return Buffer.from(raw, "hex");
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    throw new Error("Password must be 10-200 characters");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  });
  return "scrypt$16384$8$1$" + salt.toString("base64url") + "$" + Buffer.from(derived).toString("base64url");
}

export async function verifyPassword(password, encoded) {
  try {
    const parts = String(encoded).split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), maxmem: 64 * 1024 * 1024
    });
    return timingSafeEqual(expected, Buffer.from(derived));
  } catch {
    return false;
  }
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptSecret(encoded) {
  const parts = String(encoded).split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[0], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[2], "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function hashAgentSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

export function verifyAgentHmac(secret, timestamp, body, signature) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret)
    .update(String(timestamp) + "." + body)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(String(signature), "hex"));
  } catch {
    return false;
  }
}

export function signAgentPayload(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret)
    .update(String(timestamp) + "." + body)
    .digest("hex");
  return { timestamp: String(timestamp), signature };
}
