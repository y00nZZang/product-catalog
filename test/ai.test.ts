import { test } from "node:test";
import assert from "node:assert/strict";
import { researchPackage } from "../src/ai/package-research";
import { suggestPackage } from "../src/ai/package-proposal";
import { AiService } from "../src/ai/service";
import { emptyProduct, identify } from "../src/domain";
import { Recorder } from "../src/jobs/recorder";
const nil = { value: null, evidence: null };
class FakeAi extends AiService {
  responses: any[] = [];
  override async call() {
    return this.responses.shift();
  }
}
test("LLM supplement rejects invented values and unsupported numeric evidence", async () => {
  const ai = new FakeAi();
  ai.responses = [
    {
      output_parsed: {
        title: nil,
        description: { value: "invented", evidence: "legitimate text" },
        seller: nil,
        price: { value: "999", evidence: "legitimate text" },
        currency: { value: "USD", evidence: "legitimate text" },
        condition: nil,
        domesticShipping: nil,
        translatedTitle: null,
      },
    },
  ];
  const p = emptyProduct();
  p.title = "Album";
  const out = await ai.supplement(
    p,
    "legitimate text",
    identify("https://jp.mercari.com/item/m1"),
    new Recorder("unused"),
  );
  assert.equal(out.description, null);
  assert.equal(out.price, null);
  assert.equal(out.currency, null);
});
test("LLM supplement cannot overwrite source-verified price or populate option prices", async () => {
  const ai = new FakeAi();
  const response = {
    output_parsed: {
      title: nil,
      description: nil,
      seller: nil,
      price: { value: "999", evidence: "Price 999" },
      currency: nil,
      condition: nil,
      domesticShipping: nil,
      translatedTitle: null,
    },
  };
  ai.responses = [response, response];
  const p = emptyProduct();
  p.price = 500;
  p.title = "Album";
  assert.equal(
    (
      await ai.supplement(
        p,
        "Price 999",
        identify("https://jp.mercari.com/item/m1"),
        new Recorder("unused"),
      )
    ).price,
    500,
  );
  p.price = null;
  assert.equal(
    (
      await ai.supplement(
        p,
        "Price 999",
        identify("https://item.rakuten.co.jp/a/b/?option=x"),
        new Recorder("unused"),
      )
    ).price,
    null,
  );
});
test("package research needs exact identifier and only accepts actually cited sources", async () => {
  const ai = new FakeAi();
  const p = emptyProduct();
  p.title = "Album";
  const id = identify("https://jp.mercari.com/item/m1");
  assert.equal(
    (await researchPackage(ai, p, id, new Recorder("unused"))).reason,
    "exact_identifier_required",
  );
  p.identifiers = ["4988031871201"];
  ai.responses = [
    {
      output: [
        {
          type: "web_search_call",
          action: { sources: [{ url: "https://example.com/spec" }] },
        },
      ],
      output_text: "report",
    },
    {
      output_parsed: {
        matchedIdentifier: "wrong",
        packageWeightGrams: 100,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 2,
        basis: "verified",
        sources: ["https://example.com/spec"],
        assumptions: [],
        productWeightGrams: 80,
      },
    },
  ];
  assert.equal(
    (await researchPackage(ai, p, id, new Recorder("unused"))).package,
    null,
  );
});

test("manual package analysis works without identifiers but rejects uncited search guesses", async () => {
  const ai = new FakeAi();
  const p = emptyProduct();
  p.title = "Figure";
  p.description = "Wrapped in bubble wrap and cardboard.";
  ai.responses = [
    { output_text: "Package 10 x 10 x 5 cm, 100 g", output: [] },
    {
      output_parsed: {
        match: "matched",
        weightGrams: 100,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 5,
        sources: ["https://jp.mercari.com/item/m1"],
        assumptions: [],
        explanation: "claim",
        evidenceQuotes: ["10 x 10 x 5 cm, 100 g"],
      },
    },
  ];
  const denied = await suggestPackage(
    ai,
    p,
    identify("https://jp.mercari.com/item/m1"),
    new Recorder("unused"),
  );
  assert.equal(denied.package, null);
  assert.equal(denied.partialPackage, null);
  ai.responses = [
    {
      output_parsed: {
        match: "matched",
        weightGrams: 500,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 8,
        sources: [],
        assumptions: ["user supplied packaging"],
        explanation: "사용자 추가 정보",
        evidenceQuotes: ["20 x 15 x 8 cm, 500 g"],
      },
    },
  ];
  const accepted = await suggestPackage(
    ai,
    p,
    identify("https://jp.mercari.com/item/m1"),
    new Recorder("unused"),
    "Packaging: 20 x 15 x 8 cm, 500 g",
  );
  assert.equal(accepted.package?.weightGrams, 500);
  assert.equal(accepted.requiresReview, true);
  assert.equal(accepted.package?.basis, "estimated");
});
