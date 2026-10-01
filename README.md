# Luna.win Hosting

Public website and client-panel frontend for Luna.win Discord bot hosting.

## Files

- `index.html` — public marketing page
- `panel.html` — client-panel frontend
- `panel.js` — API-aware panel actions (disabled until an API is configured)
- `styles.css` — responsive black/white moonlight visual system
- `config/plans.json` — proposed plan/resource source of truth
- `ARCHITECTURE.md` — API/agent/container architecture
- `API_CONTRACT.md` — initial frontend API contract

## Deploy

This is a static site and can be published with GitHub Pages.

The frontend deliberately does not claim live infrastructure telemetry or successful backend actions until the Luna API is connected. Real paid provisioning should remain disabled until the API, VPS agent, container isolation, billing, backups, and cancellation handling are implemented.