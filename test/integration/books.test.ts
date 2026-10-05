import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/persistence/connection";
import { submit, getRun } from "../../src/persistence/catalog.repository";
import { claimJob as claim } from "../support/jobs";
import { collect } from "../../src/ingestion/collector";
after(() => pool.end());
test("Books uses ISBN/JAN API, validates URL, and reuses lookup code on explicit refresh", async () => {
  const before = [
    process.env.RAKUTEN_APPLICATION_ID,
    process.env.RAKUTEN_ACCESS_KEY,
  ];
  process.env.RAKUTEN_APPLICATION_ID = "test";
  process.env.RAKUTEN_ACCESS_KEY = "test";
  const url = "https://books.rakuten.co.jp/rb/18584086/";
  const calls: string[] = [];
  const fetcher: any = async (raw: string) => {
    const u = new URL(raw);
    calls.push(u.hostname === "books.rakuten.co.jp" ? "html" : "books_api");
    if (u.hostname === "books.rakuten.co.jp")
      return {
        html: '<h1 itemprop="name">FJORD</h1><div id="productDetailedDescription"><li>JAN： 4988031871201</li></div>',
      };
    assert.equal(u.searchParams.get("isbnjan"), "4988031871201");
    assert.equal(u.searchParams.get("outOfStockFlag"), "1");
    return {
      html: JSON.stringify({
        Items: [
          {
            title: "FJORD",
            itemUrl: url,
            jan: "4988031871201",
            itemPrice: 5672,
            postageFlag: 2,
            availability: "1",
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
    source: "test",
  });
  try {
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now(),active_until=NULL,owner=NULL WHERE platform='rakuten'",
    );
    const r: any = await submit(url);
    await collect(await claim(), { fetcher, fxGetter });
    const done = await getRun(r.runId);
    assert.equal(done.work.status, "succeeded");
    assert.equal(done.result!.observation.data.sourceType, "rakuten_books_api");
    assert.deepEqual(calls, ["html", "books_api"]);
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now()WHERE platform='rakuten'",
    );
    const again: any = await submit(url, true);
    await collect(await claim(), { fetcher, fxGetter });
    assert.equal((await getRun(again.runId)).work.status, "succeeded");
    assert.deepEqual(calls, ["html", "books_api", "books_api"]);
  } finally {
    process.env.RAKUTEN_APPLICATION_ID = before[0] || "";
    process.env.RAKUTEN_ACCESS_KEY = before[1] || "";
  }
});
