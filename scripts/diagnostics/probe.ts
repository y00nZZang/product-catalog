import { mkdirSync, writeFileSync } from "node:fs";
import { identify, errorCode } from "../../src/domain";
import { safeGet, browserGet } from "../../src/ingestion/transport";
import { parseHtml } from "../../src/merchants/html";
import { config } from "../../src/config";
(async () => {
  const args = process.argv.slice(2);
  const browser = args.includes("--browser");
  const urls = args.filter((a) => a !== "--browser");
  if (!urls.length)
    throw Error(
      "Provide explicit product URLs; no discovery/crawling is performed.",
    );
  const results = [];
  for (const url of urls) {
    const start = performance.now();
    try {
      const id = identify(url);
      const r = browser
        ? await browserGet(id)
        : await safeGet(id.canonicalUrl, undefined, {}, id);
      const p = parseHtml(r.html, id);
      results.push({
        url: id.canonicalUrl,
        environment: config.environment,
        region: config.region,
        method: browser ? "browser" : "http",
        status: r.status,
        durationMs: performance.now() - start,
        title: p.title,
        price: p.price,
        currency: p.currency,
        warnings: p.warnings,
      });
    } catch (e) {
      results.push({
        url,
        environment: config.environment,
        region: config.region,
        method: browser ? "browser" : "http",
        durationMs: performance.now() - start,
        error: errorCode(e),
      });
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  mkdirSync("private", { recursive: true });
  const path = `private/probe-${Date.now()}.json`;
  writeFileSync(
    path,
    JSON.stringify({ observedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(path);
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
