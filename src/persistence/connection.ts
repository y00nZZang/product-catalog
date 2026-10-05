import { Pool, PoolClient } from "pg";
import { config } from "../config";
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 8,
  connectionTimeoutMillis: 5000,
});
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const v = await fn(c);
    await c.query("COMMIT");
    return v;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
