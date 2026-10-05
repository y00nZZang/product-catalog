import { readFileSync, writeFileSync } from "node:fs";
import { identify, errorCode } from "../../src/domain";
import { safeGet } from "../../src/ingestion/transport";
import { reviewSnapshot } from "./review-snapshot";

(async () => {
  const f = "test/fixtures/reviewed-2026-09-22/manifest.json";
  const d = JSON.parse(readFileSync(f, "utf8"));
  for (const s of d.samples.filter(
    (s: any) => s.captureError === "redirect_identity_changed",
  )) {
    const before = { captureError: s.captureError, capturedAt: s.capturedAt };
    try {
      const id = identify(s.url);
      const r = await safeGet(id.canonicalUrl, undefined, {}, id);
      const snap = reviewSnapshot(r.html, id);
      const path =
        "test/fixtures/reviewed-2026-09-22/" +
        id.platform +
        "-" +
        id.externalId.replace(/[^a-z0-9-]/gi, "-") +
        ".html";
      writeFileSync(path, snap.html);
      Object.assign(s, {
        htmlPath: path,
        capturedAt: new Date().toISOString(),
        captureMethod: "http",
        reviewerType: "agent",
        reviewStatus: "pending",
        expected: snap.expected,
        evidence: snap.evidence,
        previousCapture: before,
      });
      delete s.captureError;
      console.log({
        url: s.url,
        expected: s.expected,
        previousCapture: before,
      });
    } catch (e) {
      console.log({ url: s.url, error: errorCode(e) });
    }
    writeFileSync(f, JSON.stringify(d, null, 2));
    await new Promise((r) => setTimeout(r, 2500));
  }
})();
