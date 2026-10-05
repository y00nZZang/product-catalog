import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
// Import a downloaded UN Comtrade H6 reference, never synthesize missing tariff codes.
const raw = readFileSync(process.argv[2]);
const source = JSON.parse(raw.toString());
if (source.className !== "HS2022" || source.more !== false)
  throw Error("Incomplete or wrong classification edition");
const entries = source.results
  .filter(
    (r: any) =>
      /^\d{2}(?:\d{2}){0,2}$/.test(r.id) && Number(r.id.slice(0, 2)) < 98,
  )
  .map((r: any) => ({
    code: r.id,
    parent: r.parent === "TOTAL" ? null : r.parent,
    description: r.text.replace(/^\d+\s*-\s*/, ""),
  }));
const counts = [2, 4, 6].map(
  (n) => entries.filter((r: any) => r.code.length === n).length,
);
if (counts.join() !== "96,1228,5612")
  throw Error(
    "Unexpected HS2022 coverage; review source before replacing catalog",
  );
const ids = new Set(entries.map((r: any) => r.code));
if (entries.some((r: any) => r.parent && !ids.has(r.parent)))
  throw Error("Broken classification hierarchy");
writeFileSync(
  "src/customs/data/hs2022.json",
  JSON.stringify(
    {
      version: "hs2022-un-comtrade-2026-10-05",
      source: "https://comtradeapi.un.org/files/v1/app/reference/H6.json",
      retrievedAt: "2026-10-05",
      sha256: createHash("sha256").update(raw).digest("hex"),
      excluded:
        "UN statistical chapter 99; national HSK extensions not included",
      counts: {
        chapters: counts[0],
        headings: counts[1],
        subheadings: counts[2],
      },
      entries,
    },
    null,
    2,
  ) + "\n",
);
console.log({ counts });
