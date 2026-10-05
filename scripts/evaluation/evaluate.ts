import { readFileSync, writeFileSync } from "node:fs";
import { evaluateManifest } from "./core";
const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run evaluate -- manifest.json [report.json]");
  process.exit(1);
}
const report = evaluateManifest(JSON.parse(readFileSync(file, "utf8")));
if (process.argv[3])
  writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
