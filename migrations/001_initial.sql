CREATE TABLE IF NOT EXISTS listings (
 id uuid PRIMARY KEY, cache_key text NOT NULL UNIQUE, platform text NOT NULL CHECK(platform IN ('rakuten','mercari')),
 external_id text NOT NULL, canonical_url text NOT NULL, options text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS observations (
 id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listings(id), observed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, data jsonb NOT NULL, parser_version text NOT NULL, content_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_latest ON observations(listing_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS analysis_runs (
 id uuid PRIMARY KEY, kind text NOT NULL, listing_id uuid REFERENCES listings(id), observation_id uuid REFERENCES observations(id),
 shared_run_id uuid REFERENCES analysis_runs(id), status text NOT NULL, cache_hit boolean NOT NULL DEFAULT false,
 requested_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 queue_ms double precision, processing_ms double precision, total_ms double precision,
 attempt integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid,
 error_type text, warnings jsonb NOT NULL DEFAULT '[]', environment text NOT NULL, region text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_collection ON analysis_runs(listing_id) WHERE kind='collect' AND status IN ('queued','running');
CREATE INDEX IF NOT EXISTS queue_poll ON analysis_runs(available_at,requested_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS runs_listing ON analysis_runs(listing_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS runs_shared ON analysis_runs(shared_run_id) WHERE shared_run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS analysis_steps (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES analysis_runs(id), stage text NOT NULL, attempt integer NOT NULL,
 status text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, duration_ms double precision,
 method text, provider text, error_type text, input_tokens integer, output_tokens integer, search_calls integer,
 cost_usd numeric, cost_basis text, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS steps_run ON analysis_steps(run_id,started_at);
CREATE TABLE IF NOT EXISTS logistics (
 id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listings(id), observation_id uuid REFERENCES observations(id),
 run_id uuid NOT NULL REFERENCES analysis_runs(id), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS logistics_listing ON logistics(listing_id,created_at DESC);
CREATE TABLE IF NOT EXISTS quotes (
 id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listings(id), observation_id uuid NOT NULL REFERENCES observations(id),
 run_id uuid NOT NULL REFERENCES analysis_runs(id), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_listing ON quotes(listing_id,created_at DESC);
CREATE TABLE IF NOT EXISTS site_state (
 platform text PRIMARY KEY, next_allowed_at timestamptz NOT NULL DEFAULT now(), active_until timestamptz,
 owner uuid, consecutive_blocks integer NOT NULL DEFAULT 0, paused_until timestamptz
);
INSERT INTO site_state(platform) VALUES ('rakuten'),('mercari') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ai_budget (
 day date PRIMARY KEY, reserved_usd numeric NOT NULL DEFAULT 0, calls integer NOT NULL DEFAULT 0
);
