import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/persistence/connection";
import { submit, getRun } from "../../src/persistence/catalog.repository";
import { claimJob as claim } from "../support/jobs";
import { collect } from "../../src/ingestion/collector";
after(() => pool.end());
test("resolve API ID from HTML once; reuse verified ID on later refresh", async () => {
  const oldApp = process.env.RAKUTEN_APPLICATION_ID,
    oldKey = process.env.RAKUTEN_ACCESS_KEY;
  process.env.RAKUTEN_APPLICATION_ID = "test-app";
  process.env.RAKUTEN_ACCESS_KEY = "test-key";
  const url = "https://item.rakuten.co.jp/xexymix/cpxp9167f/";
  const methods: string[] = [];
  const fetcher: any = async (raw: string) => {
    const u = new URL(raw);
    if (u.hostname === "item.rakuten.co.jp") {
      methods.push("html");
      return {
        html: '<h1>Leggings</h1><script type="application/json">{"itemCode":"xexymix:10001192"}</script>',
      };
    }
    methods.push("api");
    assert.equal(u.searchParams.get("itemCode"), "xexymix:10001192");
    return {
      html: JSON.stringify({
        Items: [
          {
            itemCode: "xexymix:10001192",
            itemUrl: url,
            itemName: "Leggings",
            itemPrice: 7700,
            availability: 1,
          },
        ],
      }),
    };
  };
  const fxGetter: any = async () => ({
    base: "JPY",
    quote: "KRW",
    rate: 9,
    date: "2026-09-22",
    source: "synthetic",
  });
  try {
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now(),active_until=NULL,owner=NULL WHERE platform='rakuten'",
    );
    const a: any = await submit(url);
    const run = await claim();
    assert.equal(run.id, a.runId);
    await collect(run, { fetcher, fxGetter });
    assert.equal((await getRun(a.runId)).work.status, "succeeded");
    assert.deepEqual(methods, ["html", "api"]);
    await pool.query(
      "UPDATE observations SET expires_at=now()-interval '1 second' WHERE listing_id=$1",
      [a.listingId],
    );
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now() WHERE platform='rakuten'",
    );
    const b: any = await submit(url);
    await collect(await claim(), { fetcher, fxGetter });
    assert.equal((await getRun(b.runId)).work.status, "succeeded");
    assert.deepEqual(methods, ["html", "api", "api"]);
  } finally {
    if (oldApp === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
    else process.env.RAKUTEN_APPLICATION_ID = oldApp;
    if (oldKey === undefined) delete process.env.RAKUTEN_ACCESS_KEY;
    else process.env.RAKUTEN_ACCESS_KEY = oldKey;
  }
});
