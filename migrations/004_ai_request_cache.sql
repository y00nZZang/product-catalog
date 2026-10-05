CREATE TABLE IF NOT EXISTS ai_requests (
 cache_key text PRIMARY KEY, stage text NOT NULL, model text NOT NULL,
 owner_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('pending','succeeded','failed','not_sent')),
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, expires_at timestamptz,
 result jsonb, error_type text
);
CREATE INDEX IF NOT EXISTS ai_requests_status ON ai_requests(status,created_at);
