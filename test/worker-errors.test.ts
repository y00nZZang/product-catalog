import { test } from "node:test";
import assert from "node:assert/strict";
import { workerFailure } from "../src/jobs/errors";

test("missing role stops with safe actionable error instead of retrying forever", () => {
  const result = workerFailure(
    { code: "28000", message: "secret connection string" },
    "recover",
  );
  assert.equal(result.action, "stopping");
  assert.equal(result.code, "28000");
  assert.match(result.hint, /role/);
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("temporary connection failures retry, including AggregateError codes", () => {
  assert.equal(
    workerFailure({ errors: [{ code: "ECONNREFUSED" }] }, "claim").action,
    "retrying",
  );
  assert.equal(
    workerFailure({ errors: [{ code: "ECONNREFUSED" }] }, "claim").code,
    "ECONNREFUSED",
  );
  assert.equal(workerFailure({ code: "42P01" }, "recover").action, "stopping");
});
