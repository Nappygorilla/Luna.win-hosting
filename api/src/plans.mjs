export const PLANS = Object.freeze({
  starter: Object.freeze({ id: "starter", name: "Starter", priceMonthlyCents: 299, ramMb: 512, vcpu: 1, storageGb: 5, runtimeFamilies: ["nodejs", "python"], restartPolicy: "on-failure-with-backoff" }),
  pro: Object.freeze({ id: "pro", name: "Pro", priceMonthlyCents: 699, ramMb: 2048, vcpu: 2, storageGb: 20, runtimeFamilies: ["nodejs", "python"], restartPolicy: "on-failure-with-backoff" }),
  scale: Object.freeze({ id: "scale", name: "Scale", priceMonthlyCents: 1499, ramMb: 4096, vcpu: 4, storageGb: 40, runtimeFamilies: ["nodejs", "python"], restartPolicy: "on-failure-with-backoff" })
});

export function getPlan(id) {
  return PLANS[String(id || "").toLowerCase()] || null;
}

export function enforcePlanLimits(plan, requested = {}) {
  if (!plan) throw new Error("Unknown plan");
  const ramMb = requested.ramMb ?? plan.ramMb;
  const vcpu = requested.vcpu ?? plan.vcpu;
  const storageGb = requested.storageGb ?? plan.storageGb;
  if (!Number.isInteger(ramMb) || ramMb <= 0 || ramMb > plan.ramMb) throw new Error("RAM exceeds plan limit");
  if (!Number.isInteger(vcpu) || vcpu <= 0 || vcpu > plan.vcpu) throw new Error("vCPU exceeds plan limit");
  if (!Number.isInteger(storageGb) || storageGb <= 0 || storageGb > plan.storageGb) throw new Error("Storage exceeds plan limit");
  return { ramMb, vcpu, storageGb };
}

export function validateRuntime(plan, runtime) {
  if (!plan || !plan.runtimeFamilies.includes(runtime)) throw new Error("Unsupported runtime for plan");
}
