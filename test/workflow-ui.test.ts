import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { load } from "cheerio";
function view() {
  const elements = new Map<string, any>();
  const context: any = {
    $: (id: string) => {
      if (!elements.has(id))
        elements.set(id, { dataset: {}, textContent: "", hidden: false });
      return elements.get(id);
    },
  };
  runInNewContext(
    readFileSync("public/js/views/workflow.js", "utf8")
      .replace(/^import .*;\n/, "")
      .replaceAll("export function", "function"),
    context,
  );
  return { context, get: context.$ };
}
test("running collection advances only after current-attempt preview; failed work is not completed", () => {
  const { context: c, get } = view();
  c.resetWorkflow();
  c.collectionProgress({
    work: { status: "running", attempt: 2, preview: { attempt: 1 } },
    request: {},
  });
  assert.equal(get("stage-0").dataset.state, "running");
  c.collectionProgress({
    work: { status: "running", attempt: 2, preview: { attempt: 2 } },
    request: {},
  });
  assert.equal(get("stage-0").dataset.state, "done");
  assert.equal(get("stage-1").dataset.state, "running");
  c.collectionProgress({
    work: { status: "failed", attempt: 2, preview: { attempt: 2 } },
    request: {},
  });
  assert.equal(get("stage-1").dataset.state, "error");
});
test("successful tax worker with partial data stays partial and missing amounts are not zero", () => {
  const { context: c, get } = view();
  c.customsSummary({
    autoRun: { status: "succeeded" },
    automaticFresh: true,
    automatic: {
      data: { status: "partial", taxRangeKrw: null, scenarios: [] },
    },
  });
  assert.equal(get("stage-2").dataset.state, "partial");
  assert.match(get("summary-tax").textContent, /확인 필요/);
  c.customsSummary({
    autoRun: { status: "running" },
    automaticFresh: false,
    automatic: { data: { taxRangeKrw: { min: 999, max: 999 } } },
  });
  assert.equal(get("stage-2").dataset.state, "running");
  assert.doesNotMatch(get("summary-tax").textContent, /999/);
  c.customsSummary({
    automaticFresh: true,
    automatic: {
      data: {
        status: "estimated",
        taxRangeKrw: { min: 0, max: 0 },
        scenarios: [],
      },
    },
  });
  assert.equal(get("summary-tax").textContent, "0원");
});
test("HTML preserves controller targets once and hides optional forms in disclosures", () => {
  const $ = load(readFileSync("public/index.html", "utf8"));
  const ids = new Set<string>();
  $("[id]").each((_, e) => {
    const id = $(e).attr("id")!;
    assert.ok(!ids.has(id), `duplicate ${id}`);
    ids.add(id);
  });
  for (const file of [
    "controllers/catalog.js",
    "controllers/customs.js",
    "controllers/package.js",
    "presenters/catalog.js",
    "views/proposal.js",
    "views/run.js",
    "views/workflow.js",
  ]) {
    const source = readFileSync("public/js/" + file, "utf8");
    for (const m of source.matchAll(/\$\("([\w-]+)"\)/g))
      assert.ok(ids.has(m[1]), `${file}: missing ${m[1]}`);
  }
  assert.ok($("#package").parents("details").length > 0);
  assert.ok($("#tax-form").parents("details").length > 0);
});

test("HS identification does not present an unverified duty rate as a tax amount", () => {
  const { context: c, get } = view();
  c.customsSummary({
    automaticFresh: true,
    automatic: {
      data: {
        status: "needs_information",
        taxRangeKrw: null,
        scenarios: [],
        missingInformation: ["검증된 한국 세율 프로필이 없습니다."],
        hsClassification: {
          status: "candidate",
          candidates: [{ code: "950440", label: "놀이용 카드" }],
        },
      },
    },
  });
  assert.equal(get("summary-tax").textContent, "세율 확인 필요");
  assert.match(get("summary-category").textContent, /950440/);
  assert.equal(get("stage-2").dataset.state, "partial");
});
