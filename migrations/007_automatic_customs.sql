CREATE TABLE IF NOT EXISTS customs_fx (
 valid_from date NOT NULL, source_kind text NOT NULL,
 data jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(valid_from,source_kind)
);
CREATE INDEX IF NOT EXISTS tax_auto_key ON analysis_runs((input->>'automaticKey')) WHERE kind='tax_analysis';
