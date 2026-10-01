(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string" ? window.LUNA_API_BASE.replace(/\/$/, "") : "";
  const state = document.getElementById("api-state");
  const warning = document.getElementById("demo-warning");
  const warningText = document.getElementById("demo-warning-text");
  const toast = document.getElementById("toast");
  const actions = [...document.querySelectorAll(".api-action")];
  const provisionButton = document.getElementById("provision-button");
  const selectionTitle = document.getElementById("selection-title");
  const selectionCopy = document.getElementById("selection-copy");
  const params = new URLSearchParams(window.location.search);
  const selectedPlan = (params.get("plan") || "starter").toLowerCase();
  const requestedServiceId = params.get("service");
  const PLAN_NAMES = { starter: "Starter", pro: "Pro", scale: "Scale" };
  const PLAN_LIMITS = {
    starter: { ram: "512 MB", cpu: "1 vCPU", storage: "5 GB" },
    pro: { ram: "2 GB", cpu: "2 vCPU", storage: "20 GB" },
    scale: { ram: "4 GB", cpu: "4 vCPU", storage: "40 GB" }
  };

  let serviceId = requestedServiceId || null;
  let csrfToken = "";

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function applyPlan(planKey) {
    const key = PLAN_NAMES[planKey] ? planKey : "starter";
    const name = PLAN_NAMES[key];
    const limits = PLAN_LIMITS[key];
    selectionTitle.textContent = name + " selected";
    selectionCopy.textContent = name + " · " + limits.ram + " RAM · " + limits.cpu + " · " + limits.storage + " storage.";
    document.getElementById("bot-plan").textContent = name;
    document.getElementById("bot-ram").textContent = limits.ram;
    document.getElementById("bot-cpu").textContent = limits.cpu.replace(" vCPU", "");
    document.getElementById("bot-storage").textContent = limits.storage;
    return key;
  }

  const planKey = applyPlan(selectedPlan);

  async function getCsrf() {
    const response = await fetch(API_BASE + "/v1/auth/csrf", { credentials: "include" });
    if (!response.ok) throw new Error("Could not initialize security token");
    const data = await response.json();
    csrfToken = data.csrfToken || "";
  }

  async function api(path, options = {}) {
    const headers = {
      "Accept": "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };
    if (csrfToken && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;

    const response = await fetch(API_BASE + path, {
      credentials: "include",
      ...options,
      headers
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("API returned invalid JSON"); }
    if (!response.ok) throw Object.assign(new Error(data.error || ("API returned " + response.status)), { status: response.status });
    return data;
  }

  function renderService(service) {
    if (!service) return;
    serviceId = service.id || service.service_id || service.uuid || serviceId;
    if (service.name) document.getElementById("bot-name").textContent = service.name;
    if (service.plan) applyPlan(String(service.plan).toLowerCase());
    if (service.resources && service.resources.ram_mb) document.getElementById("bot-ram").textContent = service.resources.ram_mb + " MB";
    if (service.resources && service.resources.vcpu) document.getElementById("bot-cpu").textContent = service.resources.vcpu;
    if (service.resources && service.resources.storage_gb) document.getElementById("bot-storage").textContent = service.resources.storage_gb + " GB";
    if (service.status) document.getElementById("bot-status").textContent = service.status;
    actions.forEach(button => button.disabled = !serviceId);
    provisionButton.disabled = true;
  }

  async function loadService() {
    try {
      const data = requestedServiceId
        ? await api("/v1/services/" + encodeURIComponent(requestedServiceId))
        : await api("/v1/services");
      const service = Array.isArray(data) ? data[0] : (data.services && data.services[0]) || data.service || data;
      if (service && service.id) {
        renderService(service);
        warning.hidden = true;
        warningText.textContent = "Live service state loaded from the Luna API.";
      } else {
        warning.hidden = false;
        warningText.textContent = "API connected, but this account has no provisioned service yet.";
      }
    } catch (error) {
      if (error.status === 401) {
        warning.hidden = false;
        warningText.textContent = "Sign in first to load your services.";
        notify("Authentication required.");
      } else {
        warning.hidden = false;
        warningText.textContent = "API connection failed: " + error.message;
      }
    }
  }

  async function startCheckout() {
    try {
      provisionButton.disabled = true;
      const result = await api("/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: planKey })
      });
      if (!result.url) throw new Error("Checkout URL missing");
      window.location.assign(result.url);
    } catch (error) {
      provisionButton.disabled = false;
      notify(error.status === 401 ? "Please sign in before checkout." : error.message);
    }
  }

  async function callAction(action) {
    if (!serviceId) return notify("No live service is connected to this account.");
    try {
      const result = await api(
        "/v1/services/" + encodeURIComponent(serviceId) + "/actions/" + encodeURIComponent(action),
        { method: "POST", body: JSON.stringify({}) }
      );
      if (result.status) document.getElementById("bot-status").textContent = result.status;
      notify("Action accepted: " + action);
    } catch (error) {
      notify("Action failed: " + error.message);
    }
  }

  if (!API_BASE) {
    state.textContent = "API disconnected";
    warning.hidden = false;
    warningText.textContent = "No Luna API is connected. The selected plan is shown, but checkout, provisioning, and live telemetry are disabled.";
    provisionButton.addEventListener("click", () => notify("Checkout becomes available after the Luna API is connected."));
    return;
  }

  (async () => {
    try {
      await getCsrf();
      state.textContent = "API connected";
      state.classList.add("connected");
      warning.hidden = false;
      provisionButton.disabled = false;
      provisionButton.addEventListener("click", startCheckout);
      actions.forEach(button => button.addEventListener("click", () => callAction(button.dataset.action)));
      await loadService();
    } catch (error) {
      warning.hidden = false;
      warningText.textContent = "Could not initialize the Luna API security session.";
    }
  })();
})();
