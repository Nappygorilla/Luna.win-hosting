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
- PostgreSQL persistence for accounts, plans, subscriptions, services, jobs, agents, orders, encrypted environment variables, logs, metrics, billing events, and audit events;
- server-side resource/runtime checks and one active bot entitlement per subscription;
- Stripe subscription Checkout, signed/idempotent webhook handling, portal, and cancellation state;
- endpoint-bound, replay-checked per-agent HMAC transport;
- leased/retryable job execution with agent-capacity-aware claims;
- persistent per-service data directories plus live CPU/RAM/storage/uptime/network telemetry plumbing;
- client-side account, billing, environment, logs, usage, and activity flows.

## Production launch gate

The repository now contains the code paths for authentication, billing state, retries/leases, capacity-aware scheduling, persistent service data, logs, metrics, and environment configuration. Before accepting real paid orders, the deployment still needs:
- production email delivery, rate limiting at the edge/shared layer, abuse controls, monitoring, and alerting;
- a secure per-agent enrollment and secret-rotation process;
- verified host/filesystem quota enforcement for the advertised storage limits;
- immutable container image digests and vulnerability scanning;
- tested Stripe portal/cancellation/webhook flows;
- backup jobs with successful restore drills;
- network isolation between tenants;
- production HTTPS, secret management, PostgreSQL backups, and disaster recovery;
- end-to-end integration tests from account creation through agent/container execution;
- an actual deployment/file-ingestion pipeline for customer code;
- ENABLE_PAID_CHECKOUT=true only after the above controls pass.
