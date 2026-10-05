import { pool } from "./connection";
export async function beginStep(
  id: string,
  runId: string,
  stage: string,
  attempt: number,
  method: string,
  provider: string | null,
) {
  await pool.query(
    "INSERT INTO analysis_steps(id,run_id,stage,attempt,status,method,provider) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, runId, stage, attempt, "running", method, provider],
  );
}
export async function completeStep(id: string, start: number) {
  await pool.query(
    "UPDATE analysis_steps SET status='succeeded',finished_at=now(),duration_ms=$2 WHERE id=$1 AND status='running'",
    [id, performance.now() - start],
  );
}
export async function failStep(id: string, start: number, code: string) {
  await pool.query(
    "UPDATE analysis_steps SET status='failed',finished_at=now(),duration_ms=$2,error_type=$3 WHERE id=$1 AND status='running'",
    [id, performance.now() - start, code],
  );
}
