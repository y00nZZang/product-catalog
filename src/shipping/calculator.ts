import { readFileSync } from "node:fs";
import { PackageInput, Product } from "../domain";
import type { RateBook, QuoteComparison } from "../domain";
export const rates: RateBook = JSON.parse(
  readFileSync(
    new URL("../data/rates.json", `file://${process.cwd()}/src/`),
    "utf8",
  ),
);
export function tier(weight: number, tiers: number[][]) {
  return tiers.find(([max]) => weight <= max)?.[1] ?? null;
}
export function dimensionalWeight(pkg: PackageInput, divisor: number) {
  return Math.max(
    pkg.weightGrams,
    ((pkg.lengthCm * pkg.widthCm * pkg.heightCm) / divisor) * 1000,
  );
}
export function quotePackage(
  pkg: PackageInput,
  p: Product,
  book = rates,
): QuoteComparison {
  const stale = (Date.now() - Date.parse(book.checkedAt)) / 86400000 > 30;
  const sides = [pkg.lengthCm, pkg.widthCm, pkg.heightCm].sort((a, b) => b - a);
  const common = {
    origin: "JP",
    destination: "KR",
    package: pkg,
    rateVersion: book.version,
    rateCheckedAt: book.checkedAt,
    sources: book.sources,
    rateStale: stale,
    domesticShipping: p.domesticShipping,
    internationalDays: null,
    dispatchDays: p.dispatchDays,
    excluded: [
      "관세·부가세",
      "선택 보험",
      "특수 취급·재포장",
      "도서산간 추가비용",
    ],
    estimated: true,
  };
  const freight = tier(pkg.weightGrams, book.tenso.freight),
    handling = tier(pkg.weightGrams, book.tenso.handling);
  const sizeOk =
    sides[0] <= book.tenso.maxLengthCm &&
    sides[0] + 2 * (sides[1] + sides[2]) <= book.tenso.maxLengthGirthCm;
  const tenso = {
    ...common,
    provider: "tenso",
    sources: book.sources.slice(0, 2),
    method: "EMS",
    currency: "JPY",
    status: stale
      ? "rate_review_required"
      : !sizeOk || freight === null || handling === null
        ? "unsupported"
        : "estimated",
    freight: sizeOk ? freight : null,
    handling: sizeOk ? handling : null,
    surcharge: 0,
    knownSubtotal:
      !stale && sizeOk && freight !== null && handling !== null
        ? freight + handling
        : null,
    notes: [
      "표본 요율 범위: 5kg 이하",
      "상품가 20만엔 초과 등 별도 수수료 대상은 추가 확인 필요",
    ],
  };
  const mf = tier(pkg.weightGrams, book.malltail.freight);
  const malltail = {
    ...common,
    provider: "malltail",
    sources: book.sources.slice(2),
    method: "air",
    currency: "USD",
    status: stale
      ? "rate_review_required"
      : mf === null
        ? "unsupported"
        : "partial",
    freight: mf,
    handling: null,
    surcharge: book.malltail.fuelSurcharge,
    knownSubtotal:
      !stale && mf !== null
        ? Math.round((mf + book.malltail.fuelSurcharge) * 100) / 100
        : null,
    notes: [
      "일반회원 무게별 기본요금 + 공지된 유류할증료",
      "부피무게 및 추가 취급 조건 미검증: 확정 총액 아님",
    ],
  };
  return {
    quotes: [tenso, malltail],
    comparisonReady:
      tenso.status === "estimated" && malltail.status === "estimated",
    calculatedAt: new Date().toISOString(),
  };
}
