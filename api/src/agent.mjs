import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { signAgentPayload } from "./security.mjs";
import { getPlan, enforcePlanLimits, validateRuntime } from "./plans.mjs";

const execFileAsync = promisify(execFile);

const DATA_ROOT = process.env.LUNA_DATA_ROOT || "/var/lib/luna/services";

function serviceDataPath(serviceId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(serviceId))) throw new Error("Invalid service id");
  const root = path.resolve(DATA_ROOT);
  const target = path.resolve(root, String(serviceId));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Invalid service data path");
  return target;
}

export async function prepareServiceDataDir(serviceId) {
  const target = serviceDataPath(serviceId);
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  try {
    await execFileAsync("chown", ["10001:10001", target], { timeout: 10_000 });
  } catch {}
  return target;
}

export function dockerArgsForService(service, env = {}) {
  const plan = getPlan(service.planId);
  validateRuntime(plan, service.runtime);

  const limits = enforcePlanLimits(plan, {
    ramMb: service.ramMb,
    vcpu: service.vcpu,
    storageGb: service.storageGb
  });

  if (!service.image || !/^[a-zA-Z0-9./_:@-]+$/.test(service.image)) {
    throw new Error("Invalid container image");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(service.id)) throw new Error("Invalid service id");

  const dataPath = serviceDataPath(service.id);
  const args = [
    "run", "-d",
    "--name", "luna-" + service.id,
    "--memory", limits.ramMb + "m",
    "--cpus", String(limits.vcpu),
    "--pids-limit", "256",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--user", "10001:10001",
    "--read-only",
    "--mount", "type=bind,src=" + dataPath + ",dst=/app/data",
    "--storage-opt", "size=" + limits.storageGb + "G",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=128m",
    "--restart", "on-failure:5"
  ];

  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) throw new Error("Invalid environment key");
    args.push("--env", key + "=" + String(value));
  }

  args.push(service.image);
  return args;
}

export async function launchContainer(service, env = {}) {
  await prepareServiceDataDir(service.id);
  const args = dockerArgsForService(service, env);
  const result = await execFileAsync("docker", args, {
    timeout: 60_000,
    maxBuffer: 1024 * 1024
  });
  return result.stdout.trim();
}

export async function stopContainer(containerName) {
  await execFileAsync("docker", ["stop", "--time", "10", containerName], { timeout: 30_000 });
}

export async function restartContainer(containerName) {
  await execFileAsync("docker", ["restart", "--time", "10", containerName], { timeout: 30_000 });
}

export async function collectContainerUsage(service) {
  const name = "luna-" + service.id;
  const stats = await execFileAsync("docker", [
    "stats", "--no-stream", "--format", "{{json .}}", name
  ], { timeout: 30_000, maxBuffer: 64 * 1024 });
  const row = JSON.parse(String(stats.stdout).trim().split("\n").filter(Boolean)[0]);
  const parseBytes = value => {
    const match = String(value || "").trim().match(/^([0-9.]+)\s*([A-Za-z]+)$/);
    if (!match) return 0;
    const unit = match[2].toUpperCase();
    const factor = { B:1, KB:1000, KIB:1024, MB:1000**2, MIB:1024**2, GB:1000**3, GIB:1024**3 }[unit] || 1;
    return Number(match[1]) * factor;
  };
  const memory = String(row.MemUsage || "").split("/");
  const net = String(row.NetIO || "").split("/");
  const started = await execFileAsync("docker", ["inspect", "--format", "{{.State.StartedAt}}", name], {
    timeout: 15_000, maxBuffer: 16 * 1024
  });
  const dataPath = await prepareServiceDataDir(service.id);
  const du = await execFileAsync("du", ["-sb", dataPath], { timeout: 30_000, maxBuffer: 16 * 1024 });
  const startedAt = Date.parse(String(started.stdout).trim());
  return {
    cpuPercent: Number.parseFloat(String(row.CPUPerc || "").replace("%", "")) || 0,
    memoryBytes: parseBytes(memory[0]),
    memoryLimitBytes: parseBytes(memory[1]),
    storageBytes: Number(String(du.stdout).trim().split(/\s+/)[0] || 0),
    storageLimitBytes: Number(service.storageGb) * 1024 ** 3,
    uptimeSeconds: Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null,
    networkRxBytes: parseBytes(net[0]),
    networkTxBytes: parseBytes(net[1])
  };
}

export async function readContainerLogs(containerName, tail = 200) {
  const boundedTail = Math.max(1, Math.min(Number(tail) || 200, 500));
  const result = await execFileAsync("docker", ["logs", "--tail", String(boundedTail), "--timestamps", containerName], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return result.stdout;
}

export function enforceContainerPolicy(service) {
  const plan = getPlan(service.planId);
  const limits = enforcePlanLimits(plan, service);
  return {
    ...limits,
    runtime: service.runtime,
    restartPolicy: plan.restartPolicy
  };
}

export function signJob(secret, job) {
  const body = JSON.stringify(job);
  return { body, ...signAgentPayload(secret, body) };
}
