import { setTimeout as sleep } from "node:timers/promises";
import { signAgentPayload, verifyAgentHmac } from "./security.mjs";
import { launchContainer, stopContainer, restartContainer } from "./agent.mjs";

const API_URL = String(process.env.LUNA_API_URL || "").replace(/\/$/, "");
const AGENT_ID = String(process.env.LUNA_AGENT_ID || "");
const AGENT_SECRET = String(process.env.LUNA_AGENT_SECRET || "");

if (!API_URL || !AGENT_ID || AGENT_SECRET.length < 32) {
  throw new Error("LUNA_API_URL, LUNA_AGENT_ID, and a 32+ character LUNA_AGENT_SECRET are required");
}

async function request(path, payload) {
  const body = JSON.stringify(payload || {});
  const signed = signAgentPayload(AGENT_SECRET, body);
  const response = await fetch(API_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": AGENT_ID,
      "X-Agent-Timestamp": signed.timestamp,
      "X-Agent-Signature": signed.signature
    },
    body
  });
  const text = await response.text();
  if (response.status === 204) return null;
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("Agent API returned invalid JSON"); }
  if (!response.ok) throw new Error("Agent API " + response.status + ": " + (data.error || "request failed"));
  return data;
}

async function runJob(job) {
  const service = job.service;
  if (!service || !service.id) throw new Error("Job missing service");

  if (job.action === "provision") {
    const containerId = await launchContainer(service, job.env || {});
    return { ok: true, status: "running", containerId, serviceId: service.id };
  }

  const name = "luna-" + service.id;
  if (job.action === "start") {
    await import("node:child_process").then(({ execFile }) =>
      new Promise((resolve, reject) => execFile("docker", ["start", name], { timeout: 30_000 }, (error, stdout) => error ? reject(error) : resolve(stdout))
      )
    );
    return { ok: true, status: "running", serviceId: service.id };
  }

  if (job.action === "stop") {
    await stopContainer(name);
    return { ok: true, status: "stopped", serviceId: service.id };
  }

  if (job.action === "restart") {
    await restartContainer(name);
    return { ok: true, status: "running", serviceId: service.id };
  }

  throw new Error("Unsupported job action: " + job.action);
}

async function postResult(result, jobId) {
  const payload = { jobId, serviceId: result.serviceId, ok: result.ok, status: result.status, containerId: result.containerId };
  const body = JSON.stringify(payload);
  const signed = signAgentPayload(AGENT_SECRET, body);
  const response = await fetch(API_URL + "/v1/internal/agent/jobs/result", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": AGENT_ID,
      "X-Agent-Timestamp": signed.timestamp,
      "X-Agent-Signature": signed.signature
    },
    body
  });
  if (!response.ok) throw new Error("Failed to report job result: " + response.status);
}

async function heartbeat() {
  const payload = { at: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const signed = signAgentPayload(AGENT_SECRET, body);
  const response = await fetch(API_URL + "/v1/internal/agent/heartbeat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": AGENT_ID,
      "X-Agent-Timestamp": signed.timestamp,
      "X-Agent-Signature": signed.signature
    },
    body
  });
  if (!response.ok) throw new Error("Heartbeat failed: " + response.status);
}

async function main() {
  for (;;) {
    try {
      await heartbeat();
      const data = await request("/v1/internal/agent/jobs/claim", { at: new Date().toISOString() });
      if (data && data.job) {
        try {
          const body = JSON.stringify(data.job);
          const sig = data.signature || {};
          if (!verifyAgentHmac(AGENT_SECRET, sig.timestamp, body, sig.signature)) {
            throw new Error("Invalid signed job");
          }
          const result = await runJob(data.job);
          await postResult(result, data.job.id);
        } catch (error) {
          await postResult({
            ok: false,
            serviceId: data.job.service && data.job.service.id,
            status: "error"
          }, data.job.id).catch(() => {});
        }
      }
    } catch (error) {
      console.error(error.message);
    }
    await sleep(Number(process.env.LUNA_AGENT_POLL_MS || 2000));
  }
}

main();
