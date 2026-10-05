import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cachedTariff } from "../../src/persistence/tariff.repository";
import { pool } from "../../src/persistence/connection";
after(() => pool.end());
test("official tariff snapshots coalesce concurrent reads and expire without stale fallback", async () => {
  const key = randomUUID();
  let calls = 0;
  const load = async () => ({ sequence: ++calls });
  const results = await Promise.all(
    Array.from({ length: 6 }, () => cachedTariff(key, load)),
  );
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.sequence === 1));
  await pool.query(
    "UPDATE hsk_tariff_cache SET expires_at=now()-interval '1 second' WHERE cache_key=$1",
    [key],
  );
  await assert.rejects(
    cachedTariff(key, async () => {
      throw Error("source unavailable");
    }),
  );
  assert.equal((await cachedTariff(key, load)).sequence, 2);
});
