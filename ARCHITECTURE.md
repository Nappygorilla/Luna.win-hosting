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
   - Authentication and authorization
   - Service lifecycle orchestration
   - Plan enforcement
   - Secrets handling
   - Agent registration
   - Job queue / idempotent actions
   - Audit logging
   - Rate limiting

3. **VPS Agent**
   - Runs on each hosting node
   - Receives authenticated, scoped jobs from the API
   - Creates/updates/stops only containers assigned to that node
   - Reports health, resource usage, exit codes, and logs back to the API
   - Must not expose Docker directly to customers

4. **Isolated bot containers**
   - Non-root user
   - CPU / memory / storage quotas
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

## Important launch gate

Do not accept real paid orders until:
- authentication is implemented;
- API authorization is enforced per service;
- resource limits are enforced at container creation/update time;
- billing changes plan state in the API;
- cancellation and deletion retention are implemented;
- backups are implemented and tested;
- logs and usage metrics come from the agent rather than demo values.
