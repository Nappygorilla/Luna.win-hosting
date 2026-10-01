(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string" ? window.LUNA_API_BASE.replace(/\/$/, "") : "";
  const state = document.getElementById("api-state");
  const warning = document.getElementById("demo-warning");
  const toast = document.getElementById("toast");
  const actions = [...document.querySelectorAll(".api-action")];
  const provisionButton = document.getElementById("provision-button");
  const selectionTitle = document.getElementById("selection-title");
  const selectionCopy = document.getElementById("selection-copy");
  const demoWarningText = document.getElementById("demo-warning-text");
  const params = new URLSearchParams(window.location.search);
  const selectedPlan = (params.get("plan") || "starter").toLowerCase();
  const PLAN_NAMES = { starter: "Starter", pro: "Pro", scale: "Scale" };
  const PLAN_LIMITS = {
    starter: { ram: "512 MB", cpu: "1 vCPU", storage: "5 GB" },
    pro: { ram: "2 GB", cpu: "2 vCPU", storage: "20 GB" },
    scale: { ram: "4 GB", cpu: "4 vCPU", storage: "40 GB" }
  };

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  const planKey = PLAN_NAMES[selectedPlan] ? selectedPlan : "starter";
  const planName = PLAN_NAMES[planKey];
  const limits = PLAN_LIMITS[planKey];
  selectionTitle.textContent = planName + " selected";
  selectionCopy.textContent = planName + " · " + limits.ram + " RAM · " + limits.cpu + " · " + limits.storage + " storage.";
  document.getElementById("bot-plan").textContent = planName;
  document.getElementById("bot-ram").textContent = limits.ram;
  document.getElementById("bot-cpu").textContent = limits.cpu.replace(" vCPU", "");
  document.getElementById("bot-storage").textContent = limits.storage;

  if (!API_BASE) {
    state.textContent = "API disconnected";
    warning.hidden = false;
    demoWarningText.textContent = "No Luna API is connected. The selected plan is stored in the page flow, but provisioning is not available yet.";
    provisionButton.addEventListener("click", () => notify("Provisioning becomes available after the Luna API is connected."));
    return;
  }

  state.textContent = "API configured";
  state.classList.add("connected");
  warning.hidden = true;
  actions.forEach(button => button.disabled = false);

  async function callAction(action) {
    try {
      const response = await fetch(API_BASE + "/v1/services/discord-bot/actions/" + action, {
        method: "POST",
        credentials: "include",
        headers: { "Accept": "application/json", "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("API returned " + response.status);
      notify("Action sent: " + action);
    } catch (error) {
      notify("Action failed: " + error.message);
    }
  }

  actions.forEach(button => {
    button.addEventListener("click", () => callAction(button.dataset.action));
  });
})();