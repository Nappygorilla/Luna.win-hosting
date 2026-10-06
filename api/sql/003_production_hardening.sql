ALTER TABLE services ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS services_subscription_active_idx ON services(subscription_id) WHERE subscription_id IS NOT NULL AND status <> 'deleted';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_by text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS retry_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs(status, lease_expires_at);
CREATE TABLE IF NOT EXISTS service_metrics (
  id bigserial PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  cpu_percent numeric(7,3),
  memory_bytes bigint,
  memory_limit_bytes bigint,
  storage_bytes bigint,
  storage_limit_bytes bigint,
  uptime_seconds bigint,
  network_rx_bytes bigint,
  network_tx_bytes bigint,
  sampled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_metrics_service_idx ON service_metrics(service_id, sampled_at DESC);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

UPDATE plans SET price_monthly_cents=499 WHERE id='starter';
