(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string" ? window.LUNA_API_BASE.replace(/\/$/, "") : "";
  const state = document.getElementById("api-state");
  const warning = document.getElementById("demo-warning");
  const warningTitle = document.getElementById("panel-state-title");
  const warningText = document.getElementById("demo-warning-text");
  const signInLink = document.getElementById("panel-signin");
  const toast = document.getElementById("toast");
  const serviceList = document.getElementById("service-list");
  const actions = [...document.querySelectorAll(".api-action")];
  const provisionButton = document.getElementById("provision-button");
  const portalButton = document.getElementById("portal-button");
  const cancelButton = document.getElementById("cancel-button");
  const billingCopy = document.getElementById("billing-copy");
  const envForm = document.getElementById("env-form");
  const envList = document.getElementById("env-list");
  const addEnvButton = document.getElementById("add-env");
  const saveEnvButton = document.getElementById("save-env");
  const activityList = document.getElementById("activity-list");
  const loyaltyTier = document.getElementById("loyalty-tier");
  const loyaltyPoints = document.getElementById("loyalty-points");
  const loyaltyMonths = document.getElementById("loyalty-months");
  const loyaltyPerk = document.getElementById("loyalty-perk");
  const loyaltyNext = document.getElementById("loyalty-next");
  const loyaltyProgressLabel = document.getElementById("loyalty-progress-label");
  const loyaltyProgress = document.getElementById("loyalty-progress");
  const loyaltyNote = document.getElementById("loyalty-note");
  const params = new URLSearchParams(window.location.search);
  const requestedServiceId = params.get("service");
  const requestedPlanParam = (params.get("plan") || "").toLowerCase();
  const requestedPlan = ["starter","pro","scale"].includes(requestedPlanParam) ? requestedPlanParam : "";

  let csrfToken = "";
  let services = [];
  let selectedService = null;
  let usageTimer = null;
  let envKeys = [];

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[char]));
  }

  function setAuthWarning(authenticated, title, copy) {
    warning.hidden = false;
    warningTitle.textContent = title;
    warningText.textContent = copy;
    signInLink.hidden = authenticated;
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
    const response = await fetch(API_BASE + path, { credentials:"include", ...options, headers });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error("API returned invalid JSON"), { status:response.status }); }
    if (!response.ok) throw Object.assign(new Error(data.error || ("API returned " + response.status)), { status:response.status, data });
    return data;
  }

  function setUsage(usage) {
    const memory = Number(usage?.memoryBytes);
    const memoryLimit = Number(usage?.memoryLimitBytes);
    const storage = Number(usage?.storageBytes);
    const storageLimit = Number(usage?.storageLimitBytes);
    const cpu = Number(usage?.cpuPercent);
    document.getElementById("usage-memory").textContent = Number.isFinite(memory) ? Math.round(memory / 1024 / 1024) + " MB" : "—";
    document.getElementById("usage-cpu").textContent = Number.isFinite(cpu) ? cpu.toFixed(1) + "%" : "—";
    document.getElementById("usage-storage").textContent = Number.isFinite(storage) ? (storage / 1024 / 1024 / 1024).toFixed(2) + " GB" : "—";
    document.getElementById("memory-meter").style.width = memoryLimit > 0 ? Math.min(100, memory / memoryLimit * 100) + "%" : "0%";
    document.getElementById("cpu-meter").style.width = Number.isFinite(cpu) ? Math.min(100, Math.max(0, cpu)) + "%" : "0%";
    document.getElementById("storage-meter").style.width = storageLimit > 0 ? Math.min(100, storage / storageLimit * 100) + "%" : "0%";
  }

  function clearServiceView() {
    selectedService = null;
    if (usageTimer) clearInterval(usageTimer);
    usageTimer = null;
    document.getElementById("bot-name").textContent = "—";
    document.getElementById("bot-status").textContent = "—";
    document.getElementById("bot-plan").textContent = "—";
    document.getElementById("bot-runtime").textContent = "—";
    document.getElementById("bot-cpu").textContent = "—";
    document.getElementById("bot-ram").textContent = "—";
    document.getElementById("bot-storage").textContent = "—";
    document.getElementById("usage-state").textContent = "No service selected";
    setUsage({});
    document.getElementById("log-output").innerHTML = '<div class="log-empty">Select a service to load live logs.</div>';
    envList.innerHTML = '<div class="service-empty">Select a service to load environment keys.</div>';
    activityList.innerHTML = '<div class="service-empty">Select a service to load job history.</div>';
    actions.forEach(button => button.disabled = true);
    addEnvButton.disabled = true;
    saveEnvButton.disabled = true;
  }

  async function refreshUsage(silent = false) {
    if (!selectedService) return;
    if (!silent) document.getElementById("usage-state").textContent = "Requesting latest sample…";
    try {
      await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/actions/usage", {
        method:"POST", body:"{}"
      }).catch(() => {});
      let data = { usage:null };
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        data = await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/usage");
        if (data.usage) break;
      }
      if (!data.usage) {
        document.getElementById("usage-state").textContent = "No telemetry yet";
        setUsage({});
        return;
      }
      setUsage(data.usage);
      document.getElementById("usage-state").textContent =
        data.usage.uptimeSeconds != null ? "Updated · uptime " + Math.floor(Number(data.usage.uptimeSeconds) / 3600) + "h" : "Updated";
    } catch (error) {
      document.getElementById("usage-state").textContent = error.status === 401 ? "Sign in required" : "Telemetry unavailable";
    }
  }

  async function refreshLogs() {
    if (!selectedService) return;
    const output = document.getElementById("log-output");
    output.innerHTML = '<div class="log-empty">Requesting latest logs…</div>';
    try {
      await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/actions/logs", {
        method:"POST", body:"{}"
      }).catch(() => {});
      let data = { logs:[] };
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        data = await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/logs?limit=100");
        if (Array.isArray(data.logs) && data.logs.length) break;
      }
      const logs = Array.isArray(data.logs) ? data.logs : [];
      output.innerHTML = logs.length ? logs.map(log => {
        const time = log.created_at ? new Date(log.created_at).toLocaleString() : "—";
        return '<div class="log-entry"><span>' + escapeHtml(time) + '</span><pre>' +
          escapeHtml(log.content) + '</pre></div>';
      }).join("") : '<div class="log-empty">No logs have been recorded for this service yet.</div>';
    } catch (error) {
      output.innerHTML = '<div class="log-empty">Could not load logs: ' + escapeHtml(error.message) + '</div>';
    }
  }

  async function loadEnv() {
    if (!selectedService) return;
    try {
      const data = await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/env");
      envKeys = Array.isArray(data.keys) ? data.keys : [];
      renderEnv();
      addEnvButton.disabled = false;
      saveEnvButton.disabled = false;
    } catch (error) {
      envList.innerHTML = '<div class="service-empty">Could not load environment: ' + escapeHtml(error.message) + '</div>';
    }
  }

  function renderEnv(rows = envKeys.map(key => ({ key, configured:true }))) {
    envList.innerHTML = rows.length ? rows.map((row,index) => {
      const key = escapeHtml(row.key || "");
      return '<div class="env-editor-row" data-env-index="' + index + '">' +
        '<input class="env-key" type="text" value="' + key + '" placeholder="DISCORD_TOKEN" autocomplete="off">' +
        '<input class="env-value" type="password" value="" placeholder="' + (row.configured ? "•••••• leave blank to keep" : "value") + '" autocomplete="new-password">' +
        '<button class="mini-button env-remove" type="button" aria-label="Remove environment variable">Remove</button>' +
        '</div>';
    }).join("") : '<div class="service-empty">No environment variables configured.</div>';
    envList.querySelectorAll(".env-remove").forEach(button => {
      button.addEventListener("click", () => button.closest(".env-editor-row")?.remove());
    });
  }

  addEnvButton.addEventListener("click", () => {
    const current = [...envList.querySelectorAll(".env-editor-row")].map(row => ({
      key: row.querySelector(".env-key")?.value || "",
      configured: row.querySelector(".env-key")?.value ? true : false
    }));
    current.push({ key:"", configured:false });
    renderEnv(current);
    envList.lastElementChild?.querySelector(".env-key")?.focus();
  });

  envForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!selectedService) return;
    const body = {};
    for (const row of envList.querySelectorAll(".env-editor-row")) {
      const key = row.querySelector(".env-key")?.value.trim().toUpperCase();
      const value = row.querySelector(".env-value")?.value ?? "";
      if (!key) continue;
      if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) return notify("Invalid environment key: " + key);
      if (value) body[key] = value;
    }
    const existingKeys = new Set(envKeys);
    const visibleKeys = new Set([...envList.querySelectorAll(".env-key")].map(input => input.value.trim().toUpperCase()).filter(Boolean));
    for (const key of existingKeys) if (!visibleKeys.has(key)) body[key] = null;

    try {
      saveEnvButton.disabled = true;
      await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/env", {
        method:"PUT", body:JSON.stringify(body)
      });
      notify("Environment saved securely.");
      await loadEnv();
    } catch (error) {
      notify("Environment save failed: " + error.message);
    } finally {
      saveEnvButton.disabled = false;
    }
  });

  async function loadActivity() {
    if (!selectedService) return;
    try {
      const data = await api("/v1/services/" + encodeURIComponent(selectedService.id) + "/jobs?limit=12");
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      activityList.innerHTML = jobs.length ? jobs.map(job => {
        const when = job.created_at ? new Date(job.created_at).toLocaleString() : "—";
        return '<div class="activity-row"><span><strong>' + escapeHtml(job.action) + '</strong><small>' + escapeHtml(when) + '</small></span>' +
          '<b>' + escapeHtml(job.status) + '</b></div>';
      }).join("") : '<div class="service-empty">No jobs recorded yet.</div>';
    } catch (error) {
      activityList.innerHTML = '<div class="service-empty">Could not load activity.</div>';
    }
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
    document.getElementById("bot-cpu").textContent = service.resources?.vcpu ? service.resources.vcpu : "—";
    document.getElementById("bot-ram").textContent = service.resources?.ram_mb ? service.resources.ram_mb + " MB" : "—";
    document.getElementById("bot-storage").textContent = service.resources?.storage_gb ? service.resources.storage_gb + " GB" : "—";
    actions.forEach(button => button.disabled = false);
    provisionButton.disabled = true;
    if (usageTimer) clearInterval(usageTimer);
    refreshLogs();
    loadEnv();
    loadActivity();
    refreshUsage();
    usageTimer = setInterval(() => refreshUsage(true), 15000);
  }

  function renderServices() {
    if (!services.length) {
      serviceList.innerHTML = '<div class="service-empty">No services found. Choose a plan to begin.</div>';
      clearServiceView();
      provisionButton.disabled = !requestedPlan;
      provisionButton.textContent = requestedPlan ? "Start checkout" : "Choose a plan";
      return;
    }
    serviceList.innerHTML = services.map(service =>
      '<button class="service-item" type="button" data-id="' + escapeHtml(service.id) + '">' +
      '<span class="service-item-main"><strong>' + escapeHtml(service.name || "Untitled") + '</strong><small>' +
      escapeHtml(service.plan || "—") + ' · ' + escapeHtml(service.runtime || "—") + '</small></span>' +
      '<span class="service-item-status">' + escapeHtml(service.status || "unknown") + '</span></button>'
    ).join("");
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

  async function callAction(action) {
    if (!selectedService) return notify("Select a service first.");
    try {
      const result = await api(
        "/v1/services/" + encodeURIComponent(selectedService.id) + "/actions/" + encodeURIComponent(action),
        { method:"POST", body:"{}" }
      );
      if (result.status) {
        selectedService.status = result.status;
        document.getElementById("bot-status").textContent = result.status;
      }
      if (action === "logs") await refreshLogs();
      if (action === "usage") await refreshUsage();
      notify("Action accepted: " + action);
      await loadServices();
      await loadActivity();
    } catch (error) {
      notify("Action failed: " + error.message);
    }
  }

  async function startCheckout() {
    if (!requestedPlan) return notify("Choose a plan from the Plans section first.");
    try {
      provisionButton.disabled = true;
      const result = await api("/v1/billing/checkout", { method:"POST", body:JSON.stringify({plan:requestedPlan}) });
      if (!result.url) throw new Error("Checkout URL missing");
      window.location.assign(result.url);
    } catch (error) {
      provisionButton.disabled = false;
      notify(error.status === 401 ? "Please sign in first." : error.message);
    }
  }

  const billingStatus = status => ({
    active:"Active",
    trialing:"Trialing",
    past_due:"Past due",
    unpaid:"Unpaid",
    canceled:"Canceled"
  }[status] || status || "Unknown");

  function renderLoyalty(data) {
    const loyalty = data?.loyalty;
    if (!loyalty) {
      loyaltyTier.textContent = "—";
      loyaltyPoints.textContent = "0";
      loyaltyMonths.textContent = "0";
      loyaltyPerk.textContent = "No active subscription";
      loyaltyNext.textContent = "Subscribe to start earning loyalty rewards.";
      loyaltyProgressLabel.textContent = "0%";
      loyaltyProgress.style.width = "0%";
      loyaltyNote.textContent = "Loyalty points are earned from verified paid subscription tenure.";
      return;
    }
    loyaltyTier.textContent = loyalty.tier;
    loyaltyPoints.textContent = String(loyalty.points);
    loyaltyMonths.textContent = String(loyalty.monthsSubscribed);
    loyaltyPerk.textContent = loyalty.currentPerk;
    loyaltyNext.textContent = loyalty.nextReward;
    loyaltyProgressLabel.textContent = Math.round(loyalty.progressPercent) + "%";
    loyaltyProgress.style.width = Math.min(100, Math.max(0, loyalty.progressPercent)) + "%";
    loyaltyNote.textContent = loyalty.note;
  }

  async function loadLoyalty() {
    try {
      const data = await api("/v1/account/loyalty");
      renderLoyalty(data);
    } catch (error) {
      renderLoyalty(null);
      loyaltyNext.textContent = error.status === 401
        ? "Sign in to view your loyalty rewards."
        : "Loyalty status is temporarily unavailable.";
      loyaltyNote.textContent = "Your subscription history is used to calculate loyalty status.";
    }
  }

  async function loadBilling() {
    try {
      const data = await api("/v1/billing/subscription");
      const sub = data.subscription;
      if (!sub) {
        billingCopy.textContent = "No subscription is attached to this account.";
        portalButton.disabled = true;
        cancelButton.disabled = true;
        return;
      }
      const displayStatus = sub.cancel_at_period_end && ["active","trialing"].includes(sub.status)
        ? "Canceling at period end"
        : billingStatus(sub.status);
      billingCopy.textContent = "Plan: " + sub.plan_id + " · " + displayStatus +
        (sub.current_period_end ? " · Period end: " + new Date(sub.current_period_end).toLocaleDateString() : "");
      portalButton.disabled = !["active","trialing","past_due"].includes(sub.status);
      cancelButton.disabled = !["active","trialing","past_due"].includes(sub.status);
    } catch (error) {
      billingCopy.textContent = error.status === 401 ? "Sign in to manage billing." : "Billing status unavailable.";
    }
  }

  async function openPortal() {
    try {
      const data = await api("/v1/billing/portal", { method:"POST", body:"{}" });
      window.location.assign(data.url);
    } catch (error) { notify("Billing portal unavailable: " + error.message); }
  }

  async function cancelBilling() {
    try {
      const data = await api("/v1/billing/cancel", { method:"POST", body:"{}" });
      notify(data.cancelAtPeriodEnd ? "Cancellation scheduled for period end." : "Cancellation request sent.");
      await loadBilling();
    } catch (error) { notify("Cancellation failed: " + error.message); }
  }

  actions.forEach(button => {
    button.addEventListener("click", () => callAction(button.dataset.action));
  });
  portalButton.addEventListener("click", openPortal);
  cancelButton.addEventListener("click", cancelBilling);
  provisionButton.addEventListener("click", startCheckout);

  clearServiceView();
  if (!API_BASE) {
    state.textContent = "API disconnected";
    setAuthWarning(true, "Frontend only", "No Luna API is connected. The panel will not invent service state or telemetry.");
    provisionButton.disabled = true;
    return;
  }

  (async () => {
    try {
      await getCsrf();
      state.textContent = "API connected";
      state.classList.add("connected");
      warning.hidden = true;
      await loadServices();
      await loadBilling();
      await loadLoyalty();
    } catch (error) {
      if (error.status === 401) {
        state.textContent = "Sign in required";
        setAuthWarning(false, "Authentication required", "Sign in to view your hosted services, billing, logs, and environment configuration.");
      } else {
        setAuthWarning(true, "API initialization failed", error.message);
      }
    }
  })();
})();