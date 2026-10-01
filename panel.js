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

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
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

  async function api(path, options = {}) {
    const response = await fetch(API_BASE + path, {
      credentials: "include",
      ...options,
      headers: {
        "Accept": "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error("API returned " + response.status);
    if (response.status === 204) return null;
    return response.json();
  }

  function setConnected(connected) {
    state.textContent = connected ? "API connected" : "API disconnected";
    state.classList.toggle("connected", connected);
    actions.forEach(button => button.disabled = !connected || !serviceId);
    provisionButton.disabled = !connected || !!serviceId;
  }

  function renderService(service) {
    if (!service) return;
    serviceId = service.id || service.service_id || service.uuid || serviceId;
    if (service.name) document.getElementById("bot-name").textContent = service.name;
    if (service.plan) applyPlan(String(service.plan).toLowerCase());
    if (service.resources?.ram_mb) document.getElementById("bot-ram").textContent = service.resources.ram_mb + " MB";
    if (service.resources?.vcpu) document.getElementById("bot-cpu").textContent = service.resources.vcpu;
    if (service.resources?.storage_gb) document.getElementById("bot-storage").textContent = service.resources.storage_gb + " GB";
    if (service.status) {
      document.getElementById("bot-status").textContent = service.status;
    }
    actions.forEach(button => button.disabled = !serviceId);
  }

  async function loadService() {
    try {
      const data = requestedServiceId
        ? await api("/v1/services/" + encodeURIComponent(requestedServiceId))
        : await api("/v1/services");
      const service = Array.isArray(data) ? data[0] : (data.services?.[0] || data.service || data);
      if (service) {
        renderService(service);
        warning.hidden = true;
        warningText.textContent = "Live service state loaded from the Luna API.";
      } else {
        warning.hidden = false;
        warningText.textContent = "API connected, but no service is provisioned for this account yet.";
      }
    } catch (error) {
      warning.hidden = false;
      warningText.textContent = "API connection failed: " + error.message;
      notify("Could not load service state.");
    }
  }

  async function provisionService() {
    try {
      provisionButton.disabled = true;
      const result = await api("/v1/services", {
        method: "POST",
        body: JSON.stringify({ plan: planKey })
      });
      const service = result?.service || result;
      renderService(service);
      notify("Service provisioning request accepted.");
      if (service?.id) history.replaceState(null, "", "panel.html?plan=" + encodeURIComponent(planKey) + "&service=" + encodeURIComponent(service.id));
    } catch (error) {
      provisionButton.disabled = false;
      notify("Provisioning failed: " + error.message);
    }
  }

  async function callAction(action) {
    if (!serviceId) return notify("Select or provision a service first.");
    try {
      const result = await api("/v1/services/" + encodeURIComponent(serviceId) + "/actions/" + encodeURIComponent(action), {
        method: "POST",
        body: JSON.stringify({})
      });
      if (result?.status) document.getElementById("bot-status").textContent = result.status;
      notify("Action accepted: " + action);
    } catch (error) {
      notify("Action failed: " + error.message);
    }
  }

  if (!API_BASE) {
    setConnected(false);
    warning.hidden = false;
    warningText.textContent = "No Luna API is connected. The selected plan is real in the frontend flow, but provisioning and live telemetry are disabled.";
    provisionButton.addEventListener("click", () => notify("Provisioning becomes available after the Luna API is connected."));
    return;
  }

  setConnected(true);
  provisionButton.addEventListener("click", provisionService);
  actions.forEach(button => button.addEventListener("click", () => callAction(button.dataset.action)));
  loadService();
})();