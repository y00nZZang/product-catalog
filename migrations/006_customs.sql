CREATE TABLE IF NOT EXISTS customs_results (
 id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listings(id), observation_id uuid NOT NULL REFERENCES observations(id),
 run_id uuid NOT NULL REFERENCES analysis_runs(id), kind text NOT NULL CHECK(kind IN ('classification','estimate')),
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customs_latest ON customs_results(listing_id,kind,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_tax_analysis ON analysis_runs(listing_id) WHERE kind='tax_analysis' AND status IN ('queued','running');
