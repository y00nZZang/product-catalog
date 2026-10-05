import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/persistence/connection";
import { reserveDailyBudget } from "../../src/persistence/ai.repository";
after(() => pool.end());
test("concurrent AI budget reservations cannot overrun cap; zero/NaN fail closed", async () => {
  await assert.rejects(reserveDailyBudget(0, 0.1));
  await assert.rejects(reserveDailyBudget(1, Number.NaN));
  const r = await Promise.allSettled(
    Array.from({ length: 20 }, () => reserveDailyBudget(0.3, 0.1)),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 3);
  assert.equal(r.filter((x) => x.status === "rejected").length, 17);
  const row = (
    await pool.query("SELECT * FROM ai_budget WHERE day=CURRENT_DATE")
  ).rows[0];
  assert.equal(Number(row.reserved_usd), 0.3);
  assert.equal(row.calls, 3);
  await reserveDailyBudget(0.3, 0.1, true);
  const unlimited = (
    await pool.query("SELECT * FROM ai_budget WHERE day=CURRENT_DATE")
  ).rows[0];
  assert.equal(Number(unlimited.reserved_usd), 0.4);
  assert.equal(unlimited.calls, 4);
  await assert.rejects(reserveDailyBudget(0.3, 0.1));
  await assert.rejects(reserveDailyBudget(0.3, Number.NaN, true));
});
