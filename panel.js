(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string" ? window.LUNA_API_BASE.replace(/\/$/, "") : "";
  const state = document.getElementById("api-state");
  const warning = document.getElementById("demo-warning");
  const warningTitle = document.getElementById("panel-state-title");
  const warningText = document.getElementById("demo-warning-text");
  const toast = document.getElementById("toast");
  const serviceList = document.getElementById("service-list");
  const actions = [...document.querySelectorAll(".api-action")];
  const provisionButton = document.getElementById("provision-button");
  const portalButton = document.getElementById("portal-button");
  const cancelButton = document.getElementById("cancel-button");
  const billingCopy = document.getElementById("billing-copy");
  const params = new URLSearchParams(window.location.search);
  const requestedServiceId = params.get("service");
  const requestedPlan = (params.get("plan") || "starter").toLowerCase();

  let csrfToken = "";
  let services = [];
  let selectedService = null;

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[char]));
  }

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
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("API returned invalid JSON"); }
    if (!response.ok) throw Object.assign(new Error(data.error || ("API returned " + response.status)), { status: response.status });
    return data;
  }

  function clearServiceView() {
    selectedService = null;
    document.getElementById("bot-name").textContent = "—";
    document.getElementById("bot-status").textContent = "—";
    document.getElementById("bot-plan").textContent = "—";
    document.getElementById("bot-runtime").textContent = "—";
    document.getElementById("bot-ram").textContent = "—";
    document.getElementById("bot-storage").textContent = "—";
    document.getElementById("usage-memory").textContent = "—";
    document.getElementById("usage-cpu").textContent = "—";
    document.getElementById("usage-storage").textContent = "—";
    document.getElementById("usage-state").textContent = "Waiting for API";
    document.getElementById("memory-meter").style.width = "0%";
    document.getElementById("cpu-meter").style.width = "0%";
    document.getElementById("storage-meter").style.width = "0%";
    document.getElementById("log-output").innerHTML = '<div class="log-empty">Select a service to load live logs.</div>';
    actions.forEach(button => button.disabled = true);
  }

  function selectService(service) {
    selectedService = service;
    document.querySelectorAll(".service-item").forEach(item => {
      item.classList.toggle("selected", item.dataset.id === service.id);
    });

    document.getElementById("selection-title").textContent = service.name || "Untitled service";
    document.getElementById("selection-copy").textContent =
      (service.plan || "—") + " · " + (service.runtime || "—") + " · node " + (service.nodeId || "unassigned");
    document.getElementById("bot-name").textContent = service.name || "—";
    document.getElementById("bot-status").textContent = service.status || "—";
    document.getElementById("bot-plan").textContent = service.plan || "—";
    document.getElementById("bot-runtime").textContent = service.runtime || "—";
    document.getElementById("bot-ram").textContent = service.resources?.ram_mb ? service.resources.ram_mb + " MB" : "—";
    document.getElementById("bot-storage").textContent = service.resources?.storage_gb ? service.resources.storage_gb + " GB" : "—";
    actions.forEach(button => button.disabled = !selectedService);
    provisionButton.disabled = true;
    refreshLogs();
  }

  function renderServices() {
    if (!services.length) {
      serviceList.innerHTML = '<div class="service-empty">No services found. Choose a plan to begin.</div>';
      clearServiceView();
      provisionButton.disabled = false;
      return;
    }

    serviceList.innerHTML = services.map(service => {
      const status = escapeHtml(service.status || "unknown");
      return '<button class="service-item" type="button" data-id="' + escapeHtml(service.id) +">' +
        '<span class="service-item-main"><strong>' + escapeHtml(service.name || "Untitled") + '</strong><small>' +
        escapeHtml(service.plan || "—") + ' · ' + escapeHtml(service.runtime || "—") + '</small></span>' +
        '<span class="service-item-status">' + status + '</span></button>';
    }).join("");

    serviceList.querySelectorAll(".service-item").forEach(item => {
      item.addEventListener("click", () => {
        const service = services.find(entry => entry.id === item.dataset.id);
        if (service) selectService(service);
      });
    });

    const requested = requestedServiceId && services.find(service => service.id === requestedServiceId);
    selectService(requested || services[0]);
  }

  async function loadServices() {
    const data = await api("/v1/services");
    services = Array.isArray(data.services) ? data.services : [];
    renderServices();
  }

  async function refreshLogs() {
    if (!selectedService) return;
    const output = document.getElementById("log-output");
    output.innerHTML = '<div class="log-empty">Requesting latest logs…</div>';
    try {
      const data = await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/logs?limit=100");
      const logs = Array.isArray(data.logs) ? data.logs : [];
      if (!logs.length) {
        output.innerHTML = '<div class="log-empty">No logs have been recorded for this service yet.</div>';
        return;
      }
      output.innerHTML = logs.map(log => {
        const time = log.created_at ? new Date(log.created_at).toLocaleString() : "—";
        return '<div class="log-entry"><span>' + escapeHtml(time) + '</span><pre>' +
          escapeHtml(log.content) + '</pre></div>';
      }).join("");
    } catch (error) {
      output.innerHTML = '<div class="log-empty">Could not load logs: ' + escapeHtml(error.message) + '</div>';
    }
  }

  async function callAction(action) {
    if (!selectedService) return notify("Select a service first.");
    if (action === "logs") return refreshLogs();
    try {
      const result = await api(
        "/v1/services/" + encodeURIComponent(selectedService.id) + "/actions/" + encodeURIComponent(action),
        { method: "POST", body: "{}" }
      );
      if (result.status) {
        selectedService.status = result.status;
        document.getElementById("bot-status").textContent = result.status;
      }
      notify("Action accepted: " + action);
      await loadServices();
    } catch (error) {
      notify("Action failed: " + error.message);
    }
  }

  async function startCheckout() {
    try {
      provisionButton.disabled = true;
      const result = await api("/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: requestedPlan })
      });
      if (!result.url) throw new Error("Checkout URL missing");
      window.location.assign(result.url);
    } catch (error) {
      provisionButton.disabled = false;
      notify(error.status === 401 ? "Please sign in first." : error.message);
    }
  }

  async function loadBilling() {
    try {
      const data = await api("/v1/billing/subscription");
      const sub = data.subscription;
      if (!sub) {
        billingCopy.textContent = "No active Luna subscription is attached to this account.";
        portalButton.disabled = true;
        cancelButton.disabled = true;
        return;
      }
      billingCopy.textContent = "Plan: " + sub.plan_id + " · Status: " + sub.status +
        (sub.current_period_end ? " · Renews: " + new Date(sub.current_period_end).toLocaleDateString() : "");
      portalButton.disabled = false;
      cancelButton.disabled = !["active","trialing","past_due"].includes(sub.status);
    } catch (error) {
      billingCopy.textContent = error.status === 401
        ? "Sign in to manage billing."
        : "Billing status unavailable: " + error.message;
    }
  }

  async function openPortal() {
    try {
      const data = await api("/v1/billing/portal", { method: "POST", body: "{}" });
      window.location.assign(data.url);
    } catch (error) {
      notify("Billing portal unavailable: " + error.message);
    }
  }

  async function cancelBilling() {
    try {
      const data = await api("/v1/billing/cancel", { method: "POST", body: "{}" });
      notify(data.cancelAtPeriodEnd ? "Cancellation scheduled for period end." : "Cancellation request sent.");
      await loadBilling();
    } catch (error) {
      notify("Cancellation failed: " + error.message);
    }
  }

  clearServiceView();

  if (!API_BASE) {
    state.textContent = "API disconnected";
    warning.hidden = false;
    warningTitle.textContent = "Frontend only";
    warningText.textContent = "No Luna API is connected. The dashboard will not invent service state or demo metrics.";
    provisionButton.addEventListener("click", () => notify("Checkout becomes available after the Luna API is connected."));
    return;
  }

  (async () => {
    try {
      await getCsrf();
      state.textContent = "API connected";
      state.classList.add("connected");
      warning.hidden = true;
      provisionButton.addEventListener("click", startCheckout);
      portalButton.addEventListener("click", openPortal);
      cancelButton.addEventListener("click", cancelBilling);
      document.getElementById("refresh-logs").addEventListener("click", refreshLogs);
      await loadServices();
      await loadBilling();
    } catch (error) {
      warning.hidden = false;
      warningTitle.textContent = "API initialization failed";
      warningText.textContent = error.message;
    }
  })();
})();
