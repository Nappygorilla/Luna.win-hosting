# Luna API Contract (initial)

This static repository defines the frontend contract only. The actual API service must implement authentication, authorization, persistence, billing integration, and agent orchestration.

## Base URL

Configure the frontend with:

`window.LUNA_API_BASE = "https://api.example.com"`

## Required endpoints

- `GET /v1/services` — list services visible to the authenticated user
- `GET /v1/services/:id` — service state, plan, runtime and resource limits
- `POST /v1/services/:id/actions/start`
- `POST /v1/services/:id/actions/stop`
- `POST /v1/services/:id/actions/restart`
- `GET /v1/services/:id/logs`
- `PUT /v1/services/:id/env`
- `GET /v1/account`
- `GET /v1/account/subscription`

## Agent boundary

The public API should enqueue an authenticated service action. The VPS agent should poll or receive a signed job and execute the action locally. Customers should never receive Docker socket access or arbitrary host-level commands.

## Resource enforcement

The API should resolve the customer's active plan to a resource policy. The agent should reject container updates that exceed that policy.

The values shown in `config/plans.json` are the current product proposal, not proof that the infrastructure already enforces them.
