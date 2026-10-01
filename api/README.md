# Luna API

The API is the server-side control plane for Luna.win hosting.

## Request path

Browser → Luna API → VPS agent → isolated bot container → Discord

## Current foundation

- PostgreSQL-backed accounts, sessions, plans, subscriptions, services, jobs, agents, orders, encrypted environment variables, and audit events.
- Passwords are derived with Node's built-in crypto.scrypt; Node documents scrypt as a password-based key derivation function intended to make brute-force attacks more expensive.
- Environment variable values are encrypted at rest with AES-256-GCM.
- Browser mutations require a same-origin check plus a CSRF token.
- Plan limits are enforced server-side before a service/job is created.
- Stripe subscription Checkout Sessions are created server-side and activated through signed webhooks.
- A VPS agent runner can claim signed jobs and apply Docker resource controls.

## Run

1. Create PostgreSQL.
2. Apply api/sql/001_init.sql.
3. Set the variables in api/.env.example.
4. Install dependencies with npm install inside api/.
5. Run npm start.

## Billing

Paid checkout stays disabled unless ENABLE_PAID_CHECKOUT=true and the Stripe secrets/price IDs are configured. The website must never create or mark a service as paid based on a browser redirect alone; the Stripe webhook is the server-side source for payment/subscription state.

## Agent

The bootstrap endpoint accepts a deployment-time bootstrap secret and stores the hash of an individual agent secret. Normal heartbeat, job claim, and job-result calls use that per-agent secret with timestamped HMAC authentication.

## Production blockers

Authentication still needs email verification and recovery, billing needs cancellation/portal handling, agents need hardened enrollment and scheduling, storage quotas need real host/filesystem enforcement, and backups/restore/observability need to be operational before paid customer onboarding.
