CREATE TABLE IF NOT EXISTS fx_rates(base text PRIMARY KEY, data jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now());
