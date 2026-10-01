import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { signAgentPayload } from "./security.mjs";
import { getPlan, enforcePlanLimits, validateRuntime } from "./plans.mjs";

const execFileAsync = promisify(execFile);

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
