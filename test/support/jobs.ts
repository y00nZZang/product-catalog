import assert from "node:assert/strict";
import { claim } from "../../src/persistence/job-queue.repository";
/** Test arrangements that seed a ready job must prove it was actually claimed. */
export async function claimJob() {
  const run = await claim();
  assert.ok(run, "Expected a ready job in the isolated integration database");
  return run;
}
