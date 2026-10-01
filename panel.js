(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string" ? window.LUNA_API_BASE.replace(/\/$/, "") : "";
  const state = document.getElementById("api-state");
  const warning = document.getElementById("demo-warning");
  const toast = document.getElementById("toast");
  const actions = [...document.querySelectorAll(".api-action")];

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  if (!API_BASE) {
    state.textContent = "API disconnected";
    warning.hidden = false;
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