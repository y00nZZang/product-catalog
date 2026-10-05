import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyHs,
  hsOptions,
  hsCoverage,
  validateHsChoices,
} from "../src/customs/hs-classifier";
import { classifyTax } from "../src/customs/classifier";
import { emptyProduct } from "../src/domain";
import type { ModelCaller } from "../src/ai/executor";
const product = { ...emptyProduct(), title: "ポケモンカード PSA10" };
const evidence = "ポケモンカード";
function response(code: string) {
  return {
    reconsiderParent: false,
    candidates: [
      {
        code,
        essentialCriteriaSupported: true,
        label: "카드",
        rationale: "원문에 카드 표기",
        evidenceQuotes: [evidence],
      },
    ],
    missingInformation: [],
    explanation: "검토할 후보입니다.",
  };
}
test("official HS2022 goods hierarchy covers all 96 chapters and 5612 leaves", () => {
  assert.equal(hsCoverage.chapters, 96);
  assert.equal(hsCoverage.subheadings, 5612);
  const chapters = hsOptions();
  assert.ok(!chapters.some((x) => ["77", "99"].includes(x.code)));
  const headings = hsOptions(chapters.map((x) => x.code));
  assert.equal(headings.length, 1228);
  const leaves = hsOptions(headings.map((x) => x.code));
  assert.equal(leaves.length, 5612);
  assert.equal(new Set(leaves.map((x) => x.code)).size, 5612);
  assert.ok(leaves.some((x) => x.code === "950440"));
});
test("out-of-branch codes and invented evidence cannot pass validation", () => {
  assert.equal(
    validateHsChoices(response("491199"), hsOptions(["95"]), evidence)
      .candidates.length,
    0,
  );
  const raw = response("9504");
  raw.candidates[0].evidenceQuotes = ["not in input"];
  assert.equal(
    validateHsChoices(raw, hsOptions(["95"]), evidence).candidates.length,
    0,
  );
});
test("classification follows the catalog hierarchy without granting a tax rate", async () => {
  const calls: string[] = [];
  const codes = ["95", "9504", "950440"];
  const caller: ModelCaller = {
    call: async (_r, stage, _fn, material) => {
      calls.push(stage);
      const code = codes[calls.length - 1];
      assert.ok((material as any).options.some((x: any) => x.code === code));
      return { output_text: "", output_parsed: response(code) };
    },
  };
  const result = await classifyHs(product, "", {} as any, caller);
  assert.deepEqual(calls, ["customs_hs_2", "customs_hs_4", "customs_hs_6"]);
  assert.equal(result.candidates[0].code, "950440");
  assert.equal(result.candidates[0].description, "Games; playing cards");
  assert.equal(result.rateVerified, false);
});
test("insufficient leaf detail preserves the verified heading candidate", async () => {
  let n = 0;
  const caller: ModelCaller = {
    call: async () => ({
      output_text: "",
      output_parsed:
        ++n < 3
          ? response(n === 1 ? "95" : "9504")
          : {
              reconsiderParent: false,
              candidates: [],
              missingInformation: ["용도 필요"],
              explanation: "세부 정보 부족",
            },
    }),
  };
  const result = await classifyHs(product, "", {} as any, caller);
  assert.equal(result.status, "needs_information");
  assert.equal(result.candidates[0].code, "9504");
});
test("corrupted input is not classified as a guessed food or tariff profile", async () => {
  let calls = 0;
  const caller: ModelCaller = {
    call: async () => {
      calls++;
      throw Error("must not call");
    },
  };
  const result = await classifyTax(
    { ...product, title: "���� 16g×10" },
    "",
    {} as any,
    caller,
  );
  assert.equal(calls, 0);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.hsClassification?.status, "needs_information");
});

test("literal product evidence alone cannot justify a missing essential classification criterion", () => {
  const raw = response("97");
  raw.candidates[0].essentialCriteriaSupported = false;
  assert.equal(
    validateHsChoices(raw, hsOptions(), evidence).candidates.length,
    0,
  );
});

test("a rejected leaf branch is reconsidered once using sibling headings", async () => {
  let n = 0;
  const stages: string[] = [];
  const caller: ModelCaller = {
    call: async (_r, stage, _fn, material) => {
      stages.push(stage);
      n++;
      if (n === 3)
        return {
          output_text: "",
          output_parsed: {
            candidates: [],
            reconsiderParent: true,
            missingInformation: [],
            explanation: "선택된 부모에 맞는 하위 품목 없음",
          },
        };
      const code = (
        { 1: "95", 2: "9503", 4: "9504", 5: "950440" } as Record<number, string>
      )[n];
      const options = (material as any).options;
      assert.ok(options.some((x: any) => x.code === code));
      if (n === 4) {
        assert.ok(!options.some((x: any) => x.code === "9503"));
        assert.ok(
          options
            .find((x: any) => x.code === "9504")
            .childDescriptions.includes("Games; playing cards"),
        );
      }
      return { output_text: "", output_parsed: response(code) };
    },
  };
  const result = await classifyHs(product, "", {} as any, caller);
  assert.equal(result.candidates[0].code, "950440");
  assert.equal(stages.length, 5);
  assert.equal(stages[4], "customs_hs_6_reconsider");
});

test("only cited official classification sources are admitted", async () => {
  const { officialHsSources } = await import("../src/customs/hs-research.js");
  assert.deepEqual(
    officialHsSources([
      {
        action: {
          sources: [
            { url: "https://rulings.cbp.gov/ruling/EXAMPLE" },
            { url: "https://customs.go.kr.evil.example/rate" },
            { url: "https://user:secret@customs.go.kr/x" },
            { url: "http://customs.go.kr/x" },
          ],
        },
      },
    ]),
    ["https://rulings.cbp.gov/ruling/EXAMPLE"],
  );
});
