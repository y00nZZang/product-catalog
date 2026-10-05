import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateModelCost, modelOptions } from "../src/ai/model";
import { config } from "../src/config";
import { aiRequestKey } from "../src/persistence/ai.repository";
test("Luna usage is not priced or cached as the old model", () => {
  const result = estimateModelCost("gpt-6-luna", 1000000, 1000000, 1);
  assert.ok(Math.abs(result.amount - 0.61) < 1e-9);
  assert.match(result.basis, /gpt-6-luna/);
  assert.notEqual(
    aiRequestKey("estimate", "gpt-4.1-mini", {}),
    aiRequestKey("estimate", "gpt-6-luna", {}),
  );
  assert.throws(() => estimateModelCost("unknown", 1, 1, 0));
});
test("reasoning is explicit for Luna and absent for the legacy fallback", () => {
  const before = config.model;
  try {
    config.model = "gpt-6-luna";
    assert.equal(modelOptions().reasoning?.effort, "none");
    config.model = "gpt-4.1-mini";
    assert.equal(modelOptions().reasoning, undefined);
  } finally {
    config.model = before;
  }
});

test("cache writes and reads use their own Luna prices", () => {
  const result = estimateModelCost("gpt-6-luna", 1000, 100, 1, {
    cached_tokens: 500,
    cache_write_tokens: 300,
  });
  assert.ok(Math.abs(result.amount - 0.0101125) < 1e-10);
});
