ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS processing_complete boolean NOT NULL DEFAULT true;
