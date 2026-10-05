CREATE TABLE IF NOT EXISTS hsk_tariff_cache (
 cache_key text PRIMARY KEY,
 data jsonb NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
