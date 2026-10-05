import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/persistence/connection";
import {
  aiRequestKey,
  claimAiRequest,
  completeAiRequest,
  failAiRequest,
} from "../../src/persistence/ai.repository";
after(() => pool.end());
test("durable cache gives one owner, reuses response, and blocks uncertain or failed redispatch", async () => {
  const key = aiRequestKey("extract", "model", {
    url: "https://example.com/p",
    text: "source",
  });
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, () => claimAiRequest(key, "extract", "model")),
  );
  const winners = attempts.filter((r) => r.status === "fulfilled");
  assert.equal(winners.length, 1);
  const claim = (winners[0] as PromiseFulfilledResult<any>).value;
  assert.equal(claim.cached, false);
  await completeAiRequest(key, claim.ownerId, {
    status: "completed",
    output_text: "result",
    usage: { input_tokens: 5 },
  });
  const cached = await claimAiRequest(key, "extract", "model");
  assert.equal(cached.cached, true);
  if (cached.cached) assert.equal(cached.result.output_text, "result");
  const changed = aiRequestKey("extract", "model", {
    url: "https://example.com/p",
    text: "changed",
  });
  assert.notEqual(key, changed);
  const next = await claimAiRequest(changed, "extract", "model");
  await failAiRequest(changed, next.ownerId, "timeout", true);
  await assert.rejects(
    claimAiRequest(changed, "extract", "model"),
    (e: any) => e.code === "ai_previous_request_failed",
  );
  const pending = aiRequestKey("search", "model", "pending");
  await claimAiRequest(pending, "search", "model");
  await pool.query(
    "UPDATE ai_requests SET created_at=now()-interval '1 day' WHERE cache_key=$1",
    [pending],
  );
  await assert.rejects(
    claimAiRequest(pending, "search", "model"),
    (e: any) => e.code === "ai_request_pending_or_unknown",
  );
  const notSent = aiRequestKey("extract", "model", "budget");
  const unissued = await claimAiRequest(notSent, "extract", "model");
  await failAiRequest(notSent, unissued.ownerId, "ai_budget_exhausted", false);
  assert.equal(
    (await claimAiRequest(notSent, "extract", "model")).cached,
    false,
  );
});
