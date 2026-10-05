ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS input jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS one_active_package_analysis ON analysis_runs(listing_id) WHERE kind='package_analysis' AND status IN ('queued','running');
