(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string" ? window.LUNA_API_BASE.replace(/\/$/, "") : "";
  const params = new URLSearchParams(window.location.search);
  let mode = ["login","register","forgot","verify","reset"].includes(params.get("mode")) ? params.get("mode") : "register";
  const plan = ["starter","pro","scale"].includes((params.get("plan") || "").toLowerCase()) ? params.get("plan").toLowerCase() : "starter";
  const token = params.get("token") || "";

  const names = { starter:"Starter", pro:"Pro", scale:"Scale" };
  const details = { starter:"8 GB RAM · 4 vCPU · 100 GB SSD", pro:"12 GB RAM · 6 vCPU · 200 GB SSD", scale:"24 GB RAM · 8 vCPU · 300 GB SSD" };

  const title = document.getElementById("auth-title");
  const copy = document.getElementById("auth-copy");
  const form = document.getElementById("auth-form");
  const emailLabel = document.getElementById("email-label");
  const passwordLabel = document.getElementById("password-label");
  const email = document.getElementById("email");
  const password = document.getElementById("password");
  const verifyToken = document.getElementById("verify-token");
  const resetToken = document.getElementById("reset-token");
  const verifyWrap = document.getElementById("verify-token-wrap");
  const resetWrap = document.getElementById("reset-token-wrap");
  const submit = document.getElementById("submit-button");
  const modeButton = document.getElementById("mode-button");
  const links = document.getElementById("auth-links");
  const message = document.getElementById("form-message");
  const resendButton = document.createElement("button");
  resendButton.type = "button";
  resendButton.className = "text-button verify-resend";
  resendButton.textContent = "Resend verification email";
  resendButton.hidden = true;
  document.getElementById("auth-links").after(resendButton);
  const selectedPlan = document.getElementById("selected-plan");

  document.getElementById("plan-name").textContent = names[plan];
  document.getElementById("plan-details").textContent = details[plan];

  let csrfToken = "";

  function setMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle("error", error);
  }

  function renderMode() {
    verifyWrap.hidden = mode !== "verify";
    resetWrap.hidden = mode !== "reset";
    passwordLabel.hidden = ["forgot","verify"].includes(mode);
    emailLabel.hidden = mode === "reset";
    selectedPlan.hidden = ["forgot","verify","reset"].includes(mode);

    if (mode === "login") {
      title.textContent = "Welcome back.";
      copy.textContent = "Sign in to manage your Luna Hosting services.";
      submit.textContent = "Sign in";
      modeButton.textContent = "Create an account";
      emailLabel.hidden = false;
      passwordLabel.hidden = false;
    } else if (mode === "forgot") {
      title.textContent = "Recover your account.";
      copy.textContent = "We'll send a password-reset link when the account exists.";
      submit.textContent = "Send reset link";
      modeButton.textContent = "Back to sign in";
    } else if (mode === "verify") {
      title.textContent = "Verify your email.";
      copy.textContent = "Paste the token from your Luna verification email.";
      submit.textContent = "Verify email";
      modeButton.textContent = "Back to sign in";
      verifyToken.value = token;
    } else if (mode === "reset") {
      title.textContent = "Set a new password.";
      copy.textContent = "Use the one-time reset token from your Luna email.";
      submit.textContent = "Reset password";
      modeButton.textContent = "Back to sign in";
      resetToken.value = token;
    } else {
      title.textContent = "Create your account.";
      copy.textContent = "Your plan selection will be carried into the secure checkout flow.";
      submit.textContent = "Create account";
      modeButton.textContent = "Sign in instead";
    }

    links.hidden = ["forgot","verify","reset"].includes(mode);
    resendButton.hidden = mode !== "verify";
  }

  async function init() {
    if (!API_BASE) {
      setMessage("Luna API is not connected yet. Account actions are unavailable.", true);
      submit.disabled = true;
      modeButton.disabled = true;
      return;
    }
    const response = await fetch(API_BASE + "/v1/auth/csrf", { credentials:"include" });
    if (!response.ok) throw new Error("Could not initialize account security");
    const data = await response.json();
    csrfToken = data.csrfToken || "";
  }

  async function request(path, body) {
    const response = await fetch(API_BASE + path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type":"application/json", "X-CSRF-Token":csrfToken, "Accept":"application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || "Request failed"), { status:response.status, data });
    return data;
  }

  async function submitForm(event) {
    event.preventDefault();
    if (!API_BASE || !csrfToken) return;
    submit.disabled = true;
    setMessage("Working…");

    try {
      if (mode === "forgot") {
        await request("/v1/auth/request-password-reset", { email:email.value.trim() });
        setMessage("If the account exists, a reset email has been sent.");
        return;
      }

      if (mode === "verify") {
        await request("/v1/auth/verify-email", { token:verifyToken.value.trim() });
        mode = "login";
        renderMode();
        setMessage("Email verified. You can sign in now.");
        return;
      }

      if (mode === "reset") {
        await request("/v1/auth/reset-password", { token:resetToken.value.trim(), password:password.value });
        mode = "login";
        renderMode();
        setMessage("Password reset. Sign in with your new password.");
        return;
      }

      const authResult = await request(
        mode === "login" ? "/v1/auth/login" : "/v1/auth/register",
        { email:email.value.trim(), password:password.value }
      );

      if (!authResult.emailVerified && mode === "register") {
        mode = "verify";
        renderMode();
        setMessage("Account created. Verify your email before checkout.");
        return;
      }

      const checkout = await request("/v1/billing/checkout", { plan });
      if (!checkout.url) throw new Error("Checkout URL missing");
      window.location.assign(checkout.url);
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

  links.querySelectorAll("[data-mode]").forEach(button => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      renderMode();
      setMessage("");
    });
  });

  resendButton.addEventListener("click", async () => {
    try {
      await request("/v1/auth/resend-verification", {});
      setMessage("A new verification email was requested.");
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  form.addEventListener("submit", submitForm);
  renderMode();
  init().catch(error => setMessage(error.message, true));
})();
