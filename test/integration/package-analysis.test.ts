import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../src/persistence/connection";
import { config } from "../../src/config";
import { emptyProduct } from "../../src/domain";
import {
  requestPackageAnalysis,
  analyzePackage,
} from "../../src/packaging/service";
import { getListing } from "../../src/persistence/catalog.repository";
import { claimJob as claim } from "../support/jobs";
after(() => pool.end());
test("manual package requests share a job, preserve user input until review, and require observation", async () => {
  const was = config.llm;
  config.llm = true;
  const listing = randomUUID(),
    obs = randomUUID();
  try {
    await pool.query(
      "INSERT INTO listings(id,cache_key,platform,external_id,canonical_url)VALUES($1,$2,'mercari','m999888777','https://jp.mercari.com/item/m999888777')",
      [listing, randomUUID()],
    );
    await assert.rejects(
      requestPackageAnalysis(listing, ""),
      (e: any) => e.code === "observation_required",
    );
    await pool.query(
      "INSERT INTO observations(id,listing_id,expires_at,data,parser_version,content_hash)VALUES($1,$2,now()+interval '1 hour',$3,'test','test')",
      [
        obs,
        listing,
        JSON.stringify({
          ...emptyProduct(),
          title: "Figure",
          description: "A figure",
        }),
      ],
    );
    const requests = await Promise.all(
      Array.from({ length: 8 }, () =>
        requestPackageAnalysis(listing, "pack hint"),
      ),
    );
    assert.equal(new Set(requests.map((r) => r.runId)).size, 1);
    assert.equal(requests.filter((r) => !r.shared).length, 1);
    await assert.rejects(
      requestPackageAnalysis(listing, "different"),
      (e: any) => e.code === "package_analysis_in_progress",
    );
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now(),active_until=NULL,owner=NULL WHERE platform='mercari'",
    );
    // Other integration tests may leave a queued recovery sample; isolate the target job for this claim.
    await pool.query(
      "UPDATE analysis_runs SET available_at=now()+interval '1 hour' WHERE status='queued' AND id<>$1",
      [requests[0].runId],
    );
    const run = await claim();
    assert.equal(run.id, requests[0].runId);
    let invoked = 0;
    const suggest: any = async () => {
      invoked++;
      return {
        package: {
          weightGrams: 500,
          lengthCm: 20,
          widthCm: 15,
          heightCm: 8,
          basis: "estimated",
          source: "test",
          assumptions: ["test"],
        },
        partialPackage: null,
        sources: [],
        reason: "ai_proposal_ready",
        requiresReview: true,
      };
    };
    await analyzePackage(run, suggest);
    assert.equal(invoked, 1);
    const result = await getListing(listing);
    assert.equal(result.logistics.data.requiresReview, true);
    assert.equal(result.logistics.data.origin, "manual_ai");
    assert.equal(result.quote, null);
  } finally {
    config.llm = was;
  }
});
