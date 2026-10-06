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

This repository contains the public frontend and the first Luna API/service foundation. The static frontend can be published with GitHub Pages, while the API runs separately against PostgreSQL.

The public landing page may use explicitly labeled illustrative preview values. Current Luna plan sizing is based on Contabo US Core VPS capacity (Cloud VPS 4/6/8); customer-facing Luna prices include hosting management margin. The client panel does not fabricate service telemetry; it shows live API data when connected and an unavailable state otherwise. Paid checkout is disabled by default and provisioning remains closed until production billing, agent deployment, backup/restore, cancellation, and host quota controls are tested.