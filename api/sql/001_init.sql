CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price_monthly_cents integer NOT NULL CHECK (price_monthly_cents >= 0),
  ram_mb integer NOT NULL CHECK (ram_mb > 0),
  vcpu integer NOT NULL CHECK (vcpu > 0),
  storage_gb integer NOT NULL CHECK (storage_gb > 0),
  runtime_families text[] NOT NULL,
  restart_policy text NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES plans(id),
  provider text NOT NULL DEFAULT 'stripe',
  provider_customer_id text,
  provider_subscription_id text UNIQUE,
  status text NOT NULL,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES plans(id),
  name text NOT NULL,
  runtime text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning',
  node_id text,
  ram_mb integer NOT NULL,
  vcpu integer NOT NULL,
  storage_gb integer NOT NULL,
  container_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS services_user_idx ON services(user_id);
CREATE INDEX IF NOT EXISTS services_node_idx ON services(node_id);

CREATE TABLE IF NOT EXISTS service_env (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  key text NOT NULL,
  encrypted_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, key)
);

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  name text NOT NULL,
  secret_hash text NOT NULL,
  encrypted_secret text,
  node_capacity jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES services(id) ON DELETE CASCADE,
  agent_id text REFERENCES agents(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, available_at);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES plans(id),
  provider text NOT NULL DEFAULT 'stripe',
  provider_session_id text UNIQUE,
  status text NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plans (id,name,price_monthly_cents,ram_mb,vcpu,storage_gb,runtime_families,restart_policy)
VALUES
  ('starter','Starter',499,512,1,5,ARRAY['nodejs','python'],'on-failure-with-backoff'),
  ('pro','Pro',699,2048,2,20,ARRAY['nodejs','python'],'on-failure-with-backoff'),
  ('scale','Scale',1499,4096,4,40,ARRAY['nodejs','python'],'on-failure-with-backoff')
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name,
  price_monthly_cents=EXCLUDED.price_monthly_cents,
  ram_mb=EXCLUDED.ram_mb,
  vcpu=EXCLUDED.vcpu,
  storage_gb=EXCLUDED.storage_gb,
  runtime_families=EXCLUDED.runtime_families,
  restart_policy=EXCLUDED.restart_policy;
