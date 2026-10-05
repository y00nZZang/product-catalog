import { pool } from "./connection";
import type { CustomsFx } from "../customs/fx";
export async function readCustomsFx(from: string): Promise<CustomsFx[]> {
  return (
    await pool.query(
      "SELECT data FROM customs_fx WHERE valid_from=$1 ORDER BY fetched_at DESC",
      [from],
    )
  ).rows.map((r) => r.data);
}
export async function writeCustomsFx(data: CustomsFx) {
  await pool.query(
    "INSERT INTO customs_fx(valid_from,source_kind,data)VALUES($1,$2,$3) ON CONFLICT(valid_from,source_kind) DO UPDATE SET data=EXCLUDED.data,fetched_at=now()",
    [data.validFrom, data.sourceKind, JSON.stringify(data)],
  );
}
