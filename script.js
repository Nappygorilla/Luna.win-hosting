const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");

if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

const terminalStatus = document.querySelector(".terminal-state");
if (terminalStatus) {
  setInterval(() => {
    terminalStatus.style.opacity = terminalStatus.style.opacity === "0.65" ? "1" : "0.65";
  }, 1800);
}

(() => {
  const API_BASE = typeof window.LUNA_API_BASE === "string"
    ? window.LUNA_API_BASE.replace(/\/$/, "")
    : "";
  const panelLinks = [
    document.getElementById("client-panel-nav"),
    document.getElementById("client-panel-terminal"),
    document.getElementById("client-panel-cta")
  ].filter(Boolean);

  if (!API_BASE || !panelLinks.length) return;

  fetch(API_BASE + "/v1/account", {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "application/json" }
  })
    .then(response => {
      if (!response.ok) return null;
      return response.json();
    })
    .then(data => {
      if (!data?.user) return;
      panelLinks.forEach(link => {
        link.hidden = false;
      });
    })
    .catch(() => {
      // Keep panel links hidden when account state cannot be verified.
    });
})();
