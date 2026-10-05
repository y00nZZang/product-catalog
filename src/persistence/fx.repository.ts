import { pool } from "./connection";
import type { FxRate } from "../domain";
export async function cachedFx(base: string): Promise<FxRate | undefined> {
  const row = (
    await pool.query(
      "SELECT data FROM fx_rates WHERE base=$1 AND fetched_at>now()-interval '6 hours'",
      [base],
    )
  ).rows[0];
  if (row) return row.data;
}
export async function saveFx(base: string, result: FxRate) {
  await pool.query(
    "INSERT INTO fx_rates(base,data) VALUES($1,$2) ON CONFLICT(base) DO UPDATE SET data=EXCLUDED.data,fetched_at=now()",
    [base, JSON.stringify(result)],
  );
}
