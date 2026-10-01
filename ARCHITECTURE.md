# Luna Hosting Architecture

## Target request path

Browser → Luna API → VPS agent → isolated bot container → Discord

The marketing site is a static frontend. It should never directly control Docker/container runtime resources.

### Components

1. **Web / Client Panel**
   - Authentication UI
   - Service list
   - Start / stop / restart
   - Logs
   - Environment variable management
   - Usage and plan limits
   - Billing/account pages once billing is connected

2. **Luna API**
   - Authentication and authorization — implemented in the initial API foundation
   - Service lifecycle orchestration — implemented as durable jobs
   - Plan enforcement — implemented server-side before service/job creation
   - Secrets handling — AES-256-GCM encrypted at rest
   - Agent registration — bootstrap endpoint plus per-agent HMAC authentication
   - Job queue / idempotent actions
   - Audit logging
   - Rate limiting

3. **VPS Agent**
   - Runs on each hosting node
   - Receives authenticated, signed jobs from the API
   - Creates/updates/stops only containers through a constrained Docker command builder
   - Reports health, resource usage, exit codes, and logs back to the API
   - Must not expose Docker directly to customers

4. **Isolated bot containers**
   - Non-root user
   - CPU / memory quotas plus a Docker storage-quota flag; host/filesystem compatibility must be validated
   - Network policy appropriate to Discord bot workloads
   - Read-only base image where practical
   - Per-service filesystem
   - Secrets injected at runtime
   - Restart policy with crash-loop backoff

5. **Discord**
   - Bots connect outbound to the Discord gateway/API
   - Discord credentials never need to be embedded in the public website

## Plan source of truth

`config/plans.json` is the intended single source of truth for public resource limits. The API and agent should consume the same plan definitions so the website cannot advertise a limit the container runtime does not enforce.

## Current implementation status

Implemented in this repository:
- account registration/login/logout with database-backed sessions;
- CSRF token flow and origin validation for browser mutations;
- PostgreSQL persistence for accounts, plans, subscriptions, services, jobs, agents, orders, encrypted environment variables, and audit events;
- server-side resource/runtime checks;
- Stripe subscription Checkout Session creation and signed webhook handling;
- signed per-agent job transport and Docker resource policy primitives;
- client-side plan → account → checkout flow.

## Production launch gate

Do not accept real paid orders until:
- email verification and account recovery are implemented;
- rate limiting, abuse controls, monitoring, and alerting are deployed;
- each VPS agent has a unique secret and secure enrollment/rotation process;
- the host/filesystem actually enforces the advertised storage quota;
- container images are pinned, built, and vulnerability scanned;
- Stripe cancellation/portal flows are implemented and tested;
- backup jobs and restore tests exist;
- job retries/idempotency and agent capacity scheduling are hardened;
- live logs/metrics are delivered from agents;
- production HTTPS, secrets storage, and database backups are configured;
- ENABLE_PAID_CHECKOUT=true is set only after the above controls pass.
