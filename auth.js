(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string" ? window.LUNA_API_BASE.replace(/\/$/, "") : "";
  const params = new URLSearchParams(window.location.search);
  let mode = params.get("mode") === "login" ? "login" : "register";
  const plan = ["starter", "pro", "scale"].includes((params.get("plan") || "").toLowerCase()) ? (params.get("plan") || "starter").toLowerCase() : "starter";

  const names = { starter: "Starter", pro: "Pro", scale: "Scale" };
  const details = {
    starter: "512 MB RAM · 1 vCPU · 5 GB storage",
    pro: "2 GB RAM · 2 vCPU · 20 GB storage",
    scale: "4 GB RAM · 4 vCPU · 40 GB storage"
  };

  const title = document.getElementById("auth-title");
  const copy = document.getElementById("auth-copy");
  const submit = document.getElementById("submit-button");
  const modeButton = document.getElementById("mode-button");
  const form = document.getElementById("auth-form");
  const message = document.getElementById("form-message");

  document.getElementById("plan-name").textContent = names[plan];
  document.getElementById("plan-details").textContent = details[plan];

  let csrfToken = "";

  function renderMode() {
    const login = mode === "login";
    title.textContent = login ? "Welcome back." : "Create your account.";
    copy.textContent = login
      ? "Sign in to continue to your Luna Hosting checkout or client panel."
      : "Your plan selection will be carried into the secure checkout flow.";
    submit.textContent = login ? "Sign in" : "Create account";
    modeButton.textContent = login ? "Create an account" : "Sign in instead";
    document.getElementById("password").autocomplete = login ? "current-password" : "new-password";
  }

  function setMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle("error", error);
  }

  async function init() {
    if (!API_BASE) {
      setMessage("Luna API is not connected yet. Account creation and checkout are unavailable.", true);
      submit.disabled = true;
      modeButton.disabled = true;
      return;
    }
    const response = await fetch(API_BASE + "/v1/auth/csrf", { credentials: "include" });
    if (!response.ok) throw new Error("Could not initialize account security");
    const data = await response.json();
    csrfToken = data.csrfToken || "";
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!API_BASE || !csrfToken) return;
    submit.disabled = true;
    setMessage("Checking your account…");

    const payload = {
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value
    };

    try {
      const endpoint = mode === "login" ? "/v1/auth/login" : "/v1/auth/register";
      const response = await fetch(API_BASE + endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Authentication failed");

      if (mode === "login" || mode === "register") {
        const checkout = await fetch(API_BASE + "/v1/billing/checkout", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
            "Accept": "application/json"
          },
          body: JSON.stringify({ plan })
        });
        const checkoutData = await checkout.json();
        if (checkout.ok && checkoutData.url) {
          window.location.assign(checkoutData.url);
          return;
        }
        if (checkout.status === 503) {
          setMessage("Account created. Paid checkout is not enabled yet.");
        } else {
          setMessage(checkoutData.error || "Account created, but checkout could not start.", true);
        }
      }
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      submit.disabled = false;
    }
  }

  modeButton.addEventListener("click", () => {
    mode = mode === "login" ? "register" : "login";
    renderMode();
    setMessage("");
  });
  form.addEventListener("submit", submitAuth);
  renderMode();
  init().catch(error => setMessage(error.message, true));
})();
