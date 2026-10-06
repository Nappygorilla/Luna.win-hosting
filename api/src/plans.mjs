import { readFileSync } from "node:fs";

const source = JSON.parse(
  readFileSync(new URL("../../config/plans.json", import.meta.url), "utf8")
);

export const PLANS = Object.freeze(
  Object.fromEntries(
    source.plans.map(plan => [
      plan.id,
      Object.freeze({
        id: plan.id,
        name: plan.name,
        priceMonthlyCents: Math.round(Number(plan.price_monthly) * 100),
        available: plan.available !== false,
        ramMb: plan.ram_mb,
        vcpu: plan.vcpu,
        storageGb: plan.storage_gb,
        runtimeFamilies: plan.runtime_families,
        restartPolicy: plan.restart_policy,
        provider: plan.provider_plan || null,
        snapshotCount: plan.snapshot_count || 0,
        portMbps: plan.port_mbps || 0,
        traffic: plan.traffic || null
      })
    ])
  )
);

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
  if (!plan || !plan.runtimeFamilies.includes(runtime)) {
    throw new Error("Unsupported runtime for plan");
  }
}
