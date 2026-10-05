import { tx } from "./connection";
/** Lock spans the bounded official fetch so concurrent workers share one normalized snapshot. */
export async function cachedTariff<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,9))", [
      key,
    ]);
    const row = (
      await c.query(
        "SELECT data FROM hsk_tariff_cache WHERE cache_key=$1 AND expires_at>now()",
        [key],
      )
    ).rows[0];
    if (row) return row.data;
    const data = await load();
    await c.query(
      "INSERT INTO hsk_tariff_cache(cache_key,data,expires_at) VALUES($1,$2,now()+interval '6 hours') ON CONFLICT(cache_key) DO UPDATE SET data=EXCLUDED.data,fetched_at=now(),expires_at=EXCLUDED.expires_at",
      [key, JSON.stringify(data)],
    );
    return data;
  });
}
