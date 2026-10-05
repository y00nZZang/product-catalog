import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { identify, errorCode } from "../../src/domain";
import { safeGet, browserGet } from "../../src/ingestion/transport";
import { parseHtml } from "../../src/merchants/html";
import { reviewSnapshot } from "./review-snapshot";
(async () => {
  const dest = "test/fixtures/reviewed-2026-09-22";
  mkdirSync(dest, { recursive: true });
  const file = dest + "/manifest.json";
  const rakuten = JSON.parse(
    readFileSync(
      "docs/evidence/rakuten-ranking-candidates-2026-09-22.json",
      "utf8",
    ),
  ).candidates;
  const mercari = JSON.parse(
    readFileSync("docs/evidence/sazo-sample-discovery-2026-09-22.json", "utf8"),
  )
    .candidates.filter((x: any) => x.platform === "mercari")
    .slice(0, 30);
  const candidates = [...rakuten, ...mercari];
  let manifest: any = {
    kind: "agent_reviewed_public_dom",
    methodology:
      "Expected values transcribed from visible product DOM, not parseHtml or JSON-LD. Product data only; no user sessions. Pending rows require agent review; no human reviewers claimed.",
    samples: [],
  };
  if (existsSync(file)) manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const candidate of candidates) {
    if (manifest.samples.some((s: any) => s.url === candidate.url)) continue;
    const id = identify(candidate.url);
    const start = performance.now();
    try {
      const r =
        id.platform === "mercari"
          ? await browserGet(id)
          : await safeGet(id.canonicalUrl, undefined, {}, id);
      const snap = reviewSnapshot(r.html, id);
      const path =
        dest +
        "/" +
        id.platform +
        "-" +
        id.externalId.replace(/[^a-z0-9-]/gi, "-") +
        ".html";
      writeFileSync(path, snap.html);
      let baseline: any;
      try {
        baseline = parseHtml(snap.html, id);
      } catch (e) {
        baseline = { error: errorCode(e) };
      }
      manifest.samples.push({
        url: id.canonicalUrl,
        discoveryUrl:
          candidate.discoveryUrl ||
          "https://books.rakuten.co.jp/ranking/daily/003/",
        rankingPrice: candidate.rankingPrice,
        platform: id.platform,
        htmlPath: path,
        capturedAt: new Date().toISOString(),
        captureMethod: id.platform === "mercari" ? "browser" : "http",
        captureMs: performance.now() - start,
        reviewerType: "agent",
        reviewStatus: "pending",
        expected: snap.expected,
        evidence: snap.evidence,
        baseline: {
          title: baseline.title,
          price: baseline.price,
          currency: baseline.currency,
          availability: baseline.availability,
          condition: baseline.condition,
          domesticShippingAmount: baseline.domesticShipping?.amount,
          error: baseline.error,
        },
      });
    } catch (e) {
      manifest.samples.push({
        url: id.canonicalUrl,
        platform: id.platform,
        discoveryUrl: candidate.discoveryUrl,
        capturedAt: new Date().toISOString(),
        captureError: errorCode(e),
        reviewStatus: "capture_failed",
        expected: {},
      });
    }
    writeFileSync(file, JSON.stringify(manifest, null, 2));
    const last = manifest.samples.at(-1);
    console.log(
      JSON.stringify({
        count: manifest.samples.length,
        platform: id.platform,
        id: id.externalId,
        price: last.expected.price,
        state: last.expected.availability,
        error: last.captureError,
      }),
    );
    await new Promise((r) => setTimeout(r, 2500));
  }
})();
