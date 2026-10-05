/** Read-only official calculator capture. Output is a review candidate, never an automatic runtime rate update. */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { safeGet } from "../../src/ingestion/transport";
async function main() {
  const source = "https://www.customs.go.kr/kcs/ad/tax/BuyTaxCalculation.do",
    scriptSource = "https://www.customs.go.kr/js/common/buyTax.js",
    hosts = new Set(["www.customs.go.kr"]);
  const html = (await safeGet(source, hosts)).html,
    script = (await safeGet(scriptSource, hosts)).html;
  const clean = script.replace(/\/\*[\s\S]*?\*\//g, "");
  const fn = clean
    .split("function checkGwanse()")[1]
    ?.split("function checkSobise()")[0];
  if (!fn || !/else\s*\{\s*gwanse\s*=\s*8;/.test(fn))
    throw Error("Calculator changed; manual review required");
  const explicit = new Map(
    [
      ...fn.matchAll(
        /item\s*==\s*(\d+)\s*&&\s*kind\s*==\s*1\s*\)\s*\{[^{}]*?gwanse\s*=\s*([\d.]+)/g,
      ),
    ].map((m) => [Number(m[1]), Number(m[2])]),
  );
  const $ = load(html),
    items = $("select[name='itemSeq'] option")
      .toArray()
      .flatMap((el) => {
        const id = Number($(el).attr("value"));
        if (!Number.isSafeInteger(id) || id <= 0) return [];
        const [group, ...rest] = $(el).text().trim().split("_");
        if (!rest.length) throw Error("Missing catalog label");
        return [
          {
            officialItem: id,
            label: rest.join("_"),
            group,
            duty: explicit.get(id) ?? 8,
            rateEvidence: explicit.has(id)
              ? "explicit_basic_branch"
              : "calculator_enumerated_item_default",
          },
        ];
      });
  if (
    !items.length ||
    new Set(items.map((i) => i.officialItem)).size !== items.length
  )
    throw Error("Invalid catalog");
  const out = process.argv[2] || "private/customs-catalog-review.json";
  writeFileSync(
    out,
    JSON.stringify(
      {
        checkedAt: new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Seoul",
        }),
        source,
        scriptSource,
        htmlSha256: createHash("sha256").update(html).digest("hex"),
        scriptSha256: createHash("sha256").update(script).digest("hex"),
        items,
      },
      null,
      2,
    ),
  );
  console.log(
    `Captured ${items.length} reference rows to ${out}; verify policy, VAT and other taxes before activation.`,
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Capture failed");
  process.exitCode = 1;
});
