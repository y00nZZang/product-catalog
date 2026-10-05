import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHtml } from "../src/merchants/html";
import { identify } from "../src/domain";
const manifest = JSON.parse(
  readFileSync("test/fixtures/public/manifest.json", "utf8"),
);
for (const s of manifest.samples)
  test("public observed markup: " + s.url, () => {
    const p = parseHtml(readFileSync(s.htmlPath, "utf8"), identify(s.url));
    for (const [key, value] of Object.entries(s.expected))
      assert.deepEqual((p as any)[key], value, key);
    assert.equal(p.domesticShipping.amount, 0);
  });
