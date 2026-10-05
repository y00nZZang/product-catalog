import { publicIp } from "../src/ingestion/network/policy";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEstimate } from "../src/ai/package-estimate-validation";
import { estimatePackage } from "../src/ai/package-estimate";
import {
  selectImageUrls,
  preparePackageImages,
} from "../src/ai/package-images";
import { emptyProduct, identify } from "../src/domain";
import { Recorder } from "../src/jobs/recorder";
import { measurementKeys } from "../src/ai/package-estimate-schema";
const sources = [
  {
    id: "listing",
    url: "https://jp.mercari.com/item/m1",
    kind: "listing" as const,
  },
  {
    id: "search_1",
    url: "https://example.com/figure",
    kind: "search" as const,
  },
];
function candidate() {
  const make = (weight: number) =>
    Object.fromEntries(
      measurementKeys.map((k) => [
        k,
        {
          range: {
            low: k === "weightGrams" ? weight : 10,
            typical: k === "weightGrams" ? weight + 50 : 15,
            high: k === "weightGrams" ? weight + 100 : 20,
          },
          basis: "similar_product",
          evidence: ["search_1"],
          assumptions: ["同シリーズの参考値、箱と緩衝材を含む"],
        },
      ]),
    ) as any;
  return {
    product: make(100),
    package: make(300),
    assumptions: ["外箱あり"],
    missingInformation: ["箱は付属しますか？"],
    explanation: "類似商品を参考にした推定",
  };
}
test("accept comparable-product ranges as review-required estimates, never verified", () => {
  const out = validateEstimate(candidate(), sources, true, "");
  assert.equal(out.package?.weightGrams, 350);
  assert.equal(out.requiresReview, true);
  assert.equal(out.package?.basis, "estimated");
  assert.equal(out.ranges.weightGrams?.low, 300);
});
test("discard fabricated evidence but retain ungrounded dimensions explicitly as assumptions", () => {
  const c = candidate();
  c.package.weightGrams.evidence = ["search_fake"];
  c.package.widthCm.basis = "visual_estimate";
  c.package.widthCm.evidence = ["visual"];
  const out = validateEstimate(c, sources, true, "");
  assert.equal(out.package?.weightGrams, 350);
  assert.equal(out.partialPackage.heightCm, 15);
  assert.equal(out.fieldEvidence.weightGrams.basis, "model_assumption");
  assert.equal(out.ranges.lengthCm?.typical, 15);
  assert.equal(out.ranges.widthCm?.typical, 15);
  assert.equal(out.fieldEvidence.widthCm.basis, "model_assumption");
});
test("reject package weight below product even when the weight has no verified source", () => {
  const c = candidate();
  c.package.weightGrams.range = { low: 1, typical: 2, high: 3 };
  c.package.weightGrams.basis = "model_assumption";
  c.package.weightGrams.evidence = [];
  assert.throws(
    () => validateEstimate(c, sources, true, ""),
    (e: any) => e.code === "invalid_package_weight",
  );
});
test("allowlist only product CDNs; cap images and continue after bounded image failure", async () => {
  const u = "https://static.mercdn.net/item/detail/orig/photos/m1_1.jpg";
  assert.deepEqual(
    selectImageUrls([
      "https://127.0.0.1/a",
      "https://static.mercdn.net.evil.com/a",
      "https://user:pass@static.mercdn.net/a",
      u,
      u,
    ]),
    [u],
  );
  const out = await preparePackageImages([u], async () => {
    throw new Error("failed");
  });
  assert.equal(out.images.length, 0);
  assert.equal(out.warnings.length, 1);
});
test("no identifier still uses image clues, search, ranges; images are absent from cache material", async () => {
  const p = emptyProduct();
  p.title = "Figure";
  p.images = ["https://static.mercdn.net/a.jpg"];
  const materials: any[] = [];
  const requests: any[] = [];
  const outputs = [
    {
      output_parsed: {
        category: "figure",
        identityClues: ["series"],
        quantity: 1,
        boxIncluded: "yes",
        observations: ["box"],
        uncertainties: [],
        searchQuery: "series figure weight",
      },
    },
    {
      output_text: "Comparable figure weighs 100g",
      output: [
        {
          type: "web_search_call",
          action: { sources: [{ url: sources[1].url }] },
        },
      ],
    },
    { output_parsed: candidate() },
  ];
  const caller = {
    call: async (_r: any, _s: any, fn: any, m: any) => {
      materials.push(m);
      await fn({
        responses: {
          parse: async (r: any) => {
            requests.push(r);
            return {};
          },
          create: async (r: any) => {
            requests.push(r);
            return {};
          },
        },
      });
      return outputs.shift() as any;
    },
  };
  const rec = {
    step: async (_s: any, _m: any, _p: any, fn: any) => fn("step"),
  } as Recorder;
  const out = await estimatePackage(
    caller,
    p,
    identify(sources[0].url),
    rec,
    "",
    async () => ({
      images: [
        {
          url: p.images[0],
          hash: "abc",
          dataUrl: "data:image/jpeg;base64,secretbytes",
        },
      ],
      warnings: [],
    }),
  );
  assert.equal(out.package?.weightGrams, 350);
  assert.equal(out.quoteScenarios.length, 3);
  assert.equal(out.imageCount, 1);
  assert.ok(JSON.stringify(requests[0]).includes("input_image"));
  assert.ok(!JSON.stringify(materials).includes("secretbytes"));
  assert.ok(materials[1].query.includes("series"));
  assert.equal(requests[1].input, "series figure weight");
});

test("NAT64 permits only translated public IPv4 addresses", async () => {
  assert.equal(publicIp("64:ff9b::ac40:9ade"), true);
  for (const ip of [
    "64:ff9b::7f00:1",
    "64:ff9b::a00:1",
    "64:ff9b::c0a8:1",
    "64:ff9b::a9fe:a9fe",
    "::1",
    "127.0.0.1",
  ])
    assert.equal(publicIp(ip), false, ip);
});

test("packing allowance follows validated product fields, not fabricated derivations", () => {
  const c = candidate();
  c.package.weightGrams.basis = "packing_allowance";
  c.package.weightGrams.evidence = ["product.weightGrams"];
  assert.equal(
    validateEstimate(c, sources, true, "").package?.weightGrams,
    350,
  );
  c.product.weightGrams.evidence = ["invented"];
  assert.equal(
    validateEstimate(c, sources, true, "").fieldEvidence.weightGrams.basis,
    "model_assumption",
  );
});

test("a product dimension cannot justify shipping weight allowance", () => {
  const c = candidate();
  c.package.weightGrams.basis = "packing_allowance";
  c.package.weightGrams.evidence = ["product.lengthCm"];
  assert.equal(
    validateEstimate(c, sources, true, "").fieldEvidence.weightGrams.basis,
    "model_assumption",
  );
});

test("missing product specs still yield four explicitly model-assumed package measurements", () => {
  const c = candidate();
  for (const key of measurementKeys) {
    c.product[key].range = null;
    c.package[key].basis = "unknown";
    c.package[key].evidence = [];
  }
  const out = validateEstimate(c, sources, false, "");
  for (const key of ["lengthCm", "widthCm", "heightCm"] as const) {
    assert.equal(out.ranges[key]?.typical, 15);
    assert.equal(out.fieldEvidence[key].basis, "model_assumption");
    assert.deepEqual(out.fieldEvidence[key].evidence, []);
  }
  assert.equal(out.package?.weightGrams, 350);
  assert.equal(out.fieldEvidence.weightGrams.basis, "model_assumption");
  assert.equal(out.scenarioNotes.length, 4);
});
test("malformed or absent dimensions fail explicitly instead of returning blank successful proposals", () => {
  for (const invalid of [
    null,
    { low: 0, typical: 5, high: 10 },
    { low: 20, typical: 5, high: 10 },
    { low: 1, typical: 5, high: 201 },
  ]) {
    const c = candidate();
    c.package.heightCm.range = invalid;
    assert.throws(() => validateEstimate(c, sources, true, ""));
  }
});
test("dimension completion has no title/category dependencies and preserves model proposed numbers", () => {
  const c = candidate();
  c.product.heightCm.range = null;
  c.package.heightCm.basis = "packing_allowance";
  c.package.heightCm.evidence = ["product.heightCm"];
  c.package.heightCm.range = { low: 12, typical: 17, high: 20 };
  const out = validateEstimate(c, sources, true, "");
  assert.deepEqual(out.ranges.heightCm, { low: 12, typical: 17, high: 20 });
  assert.equal(out.fieldEvidence.heightCm.basis, "model_assumption");
});

test("gross weight must be present, positive, ordered and within supported limits", () => {
  for (const range of [
    null,
    { low: 0, typical: 100, high: 200 },
    { low: 100, typical: 50, high: 200 },
    { low: 100, typical: 200, high: 30001 },
  ]) {
    const c = candidate();
    c.package.weightGrams.range = range;
    assert.throws(() => validateEstimate(c, sources, true, ""));
  }
});
