import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, signAgentPayload, verifyAgentHmac } from "../src/security.mjs";
import { getPlan, enforcePlanLimits, validateRuntime } from "../src/plans.mjs";
import { dockerArgsForService } from "../src/agent.mjs";
import { verifyStripeSignature } from "../src/server.mjs";
import { createHmac } from "node:crypto";

test("password hashing verifies and rejects wrong password", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword("correct horse battery", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
});

test("secret encryption round trips", () => {
  process.env.SECRETS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const encrypted = encryptSecret("super-secret-token");
  assert.notEqual(encrypted, "super-secret-token");
  assert.equal(decryptSecret(encrypted), "super-secret-token");
});

test("agent signatures verify and plan limits are enforced", () => {
  const secret = "agent-secret";
  const body = JSON.stringify({ job: "x" });
  const signed = signAgentPayload(secret, body);
  assert.equal(verifyAgentHmac(secret, signed.timestamp, body, signed.signature), true);
  const plan = getPlan("starter");
  assert.deepEqual(
    enforcePlanLimits(plan, { ramMb: 512, vcpu: 1, storageGb: 5 }),
    { ramMb: 512, vcpu: 1, storageGb: 5 }
  );
  assert.throws(() => enforcePlanLimits(plan, { ramMb: 513, vcpu: 1, storageGb: 5 }));
  assert.throws(() => validateRuntime(plan, "ruby"));
});

test("agent container policy contains CPU, memory, storage, PID and privilege limits", () => {
  const args = dockerArgsForService({ id: "abc_123", planId: "starter", runtime: "nodejs", ramMb: 512, vcpu: 1, storageGb: 5, image: "luna/node:24" });
  assert.ok(args.includes("--memory"));
  assert.ok(args.includes("512m"));
  assert.ok(args.includes("--cpus"));
  assert.ok(args.includes("1"));
  assert.ok(args.includes("--storage-opt"));
  assert.ok(args.includes("size=5G"));
  assert.ok(args.includes("--pids-limit"));
  assert.ok(args.includes("--cap-drop"));
  assert.ok(args.includes("ALL"));
});

test("stripe signature verifier accepts a valid signed payload and rejects tampering", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_test" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", secret).update(timestamp + "." + payload).digest("hex");
  const header = "t=" + timestamp + ",v1=" + digest;
  assert.equal(verifyStripeSignature(payload, header, secret), true);
  assert.equal(verifyStripeSignature(payload + "x", header, secret), false);
});
