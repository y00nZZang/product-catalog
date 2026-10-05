import { hasPriorityDuty } from "./tariff/policy";
import type { TariffResolution } from "./tariff/types";
import { packageSchema, type Product } from "../domain";
import { quotePackage } from "../shipping/calculator";
import { calculateTax, calculateHskTax, decimal } from "./calculator";
import { profiles, isAlcohol, TAX_VERSION } from "./profiles";
import type { TaxCalculationInput } from "./schema";
import type { CustomsFx } from "./fx";
import type { classifyTax } from "./classifier";
export const AUTO_TAX_VERSION = "url-estimate-v6-public-hsk";
type Classification = Awaited<ReturnType<typeof classifyTax>>;
const SCALE = 1_000_000n;
function amount(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
    ? n.toFixed(6)
    : null;
}
function krw(value: number, currency: string, fx: CustomsFx) {
  if (amount(value) === null) return null;
  const rate =
    currency === "JPY"
      ? fx.jpyToKrw
      : currency === "USD"
        ? fx.usdToKrw
        : currency === "KRW"
          ? "1"
          : null;
  if (!rate) return null;
  const fixed = (decimal(value.toFixed(6)) * decimal(rate)) / SCALE;
  return `${fixed / SCALE}.${(fixed % SCALE).toString().padStart(6, "0")}`;
}
/** No user confirmation is fabricated. These are explicit scenarios separate from approved quotes. */
export function automaticTax(
  product: Product,
  logistics: unknown,
  classification: Classification,
  fx: CustomsFx | null,
  fxError: string | null = null,
  tariffs?: TariffResolution,
) {
  const published =
    tariffs?.candidates.filter((t) => t.eligible).slice(0, 3) || [];
  const calculations = published.length
    ? published.map((t) => ({
        profile: `hsk:${t.hsk}:A`,
        label: t.name,
        tariff: t,
      }))
    : classification.candidates
        .slice(0, 3)
        .filter((c) => profiles[c.profile])
        .filter(
          (c) =>
            !tariffs?.candidates.length ||
            tariffs.candidates.every(
              (t) =>
                !hasPriorityDuty(t.rate, t.alternatives) &&
                t.rate.unitAmount === null &&
                t.rate.rate === profiles[c.profile].duty,
            ),
        )
        .map((c) => ({
          profile: c.profile,
          label: profiles[c.profile].label,
          tariff: undefined,
        }));
  const assumptions = [
    "일본→한국, 개인 자가사용, 판매글에 표시된 전체 구성 1건 구매 가정",
    "페이지 표시가격 기준; 결제 단계 할인·추가비용 미반영",
    "현재 주간 과세환율 기준 예상치이며 실제 수입신고 시점에는 환율·세율이 달라질 수 있습니다.",
    "선택 보험 미가입 가정; 확인되지 않은 필수 비용은 제외하고 별도 표시",
    "일본 판매처를 일본산 원산지로 간주하지 않으며 기본세율 시나리오 사용",
  ];
  const missing: string[] = [];
  if (tariffs) {
    missing.push(...tariffs.missingInformation);
    for (const t of tariffs.candidates.filter((t) => !t.eligible))
      missing.push(`계산 미포함 HSK ${t.hsk}: ${t.reason}`);
    if (tariffs.candidates.filter((t) => t.eligible).length > 3)
      missing.push("HSK 후보 중 최대 3개만 계산한 범위입니다.");
  }
  if (!fx) missing.push("현재 적용되는 관세청 과세환율을 확인하지 못했습니다.");
  if (
    product.price === null ||
    !product.currency ||
    amount(product.price) === null
  )
    missing.push("상품가격 또는 통화 미확인");
  if (product.options) missing.push("선택 옵션별 최종 가격 확인 필요");
  if (!calculations.length || (classification.unsupported && !published.length))
    missing.push(
      tariffs?.candidates.length
        ? "공개 세율의 적용조건 또는 기존 계산 프로필과의 차이를 확인해야 합니다."
        : classification.hsClassification?.candidates.length
          ? "HS 품목 후보는 확인했으나 검증된 한국 세율 프로필이 없습니다."
          : "계산 가능한 품목 후보 확인 필요",
    );
  const base = {
    tariffLookup: tariffs || null,
    publicTariffApplied: published.length > 0,
    hsClassification: classification.hsClassification || null,
    automatic: true,
    version: AUTO_TAX_VERSION,
    taxVersion: TAX_VERSION,
    requiresReview: true,
    fx,
    fxError,
    assumptions,
    missingInformation: missing,
  };
  if (
    !fx ||
    product.price === null ||
    !product.currency ||
    product.options ||
    !calculations.length ||
    (classification.unsupported && !published.length)
  )
    return {
      ...base,
      status: "needs_information",
      scenarios: [],
      taxRangeKrw: null,
      knownTotalRangeKrw: null,
      rangeComplete: false,
    };
  const goods = krw(product.price, product.currency, fx);
  if (goods === null)
    return {
      ...base,
      status: "needs_information",
      scenarios: [],
      taxRangeKrw: null,
      knownTotalRangeKrw: null,
      rangeComplete: false,
      missingInformation: [...missing, "지원하지 않는 가격 통화"],
    };
  const domestic =
    product.domesticShipping.amount !== null &&
    product.domesticShipping.currency
      ? krw(
          product.domesticShipping.amount,
          product.domesticShipping.currency,
          fx,
        )
      : null;
  if (domestic === null)
    missing.push("현지 배송비·조건 미확인: 제외한 금액으로 계산");
  const l = logistics as {
    package?: unknown;
    ranges?: Record<
      string,
      { low: number; typical: number; high: number } | null
    >;
  } | null;
  const pkg = packageSchema.safeParse(l?.package);
  const packages = pkg.success ? [{ name: "대표 포장", value: pkg.data }] : [];
  if (pkg.success && l?.ranges) {
    for (const bound of ["low", "high"] as const) {
      const value = { ...pkg.data };
      let valid = true;
      for (const key of [
        "weightGrams",
        "lengthCm",
        "widthCm",
        "heightCm",
      ] as const) {
        const r = l.ranges[key];
        if (!r || !Number.isFinite(r[bound]) || r[bound] <= 0) {
          valid = false;
          break;
        }
        value[key] = r[bound];
      }
      if (valid && packageSchema.safeParse(value).success)
        packages.push({
          name: bound === "low" ? "작은 포장 가정" : "큰 포장 가정",
          value,
        });
    }
  }
  const shipments = packages.flatMap((p) =>
    quotePackage(p.value, product).quotes.map((q) => ({
      scenario: p.name,
      quote: q,
    })),
  );
  if (!shipments.length)
    missing.push("포장 무게·치수 미확인: 국제운임을 제외한 참고 세금만 계산");
  const entries = shipments.length
    ? shipments
    : [{ scenario: "운임 미확정", quote: null }];
  const scenarios = [];
  for (const candidate of calculations) {
    for (const entry of entries) {
      const q = entry.quote,
        notes: string[] = [];
      if (
        q &&
        (q.rateStale || q.freight === null || q.knownSubtotal === null)
      ) {
        scenarios.push({
          profile: candidate.profile,
          label: candidate.label,
          provider: q.provider,
          scenario: entry.scenario,
          tax: null,
          reason: "배송 요율·규격 범위 확인 필요",
          missingCosts: ["국제운임"],
          knownTotalKrw: null,
          shippingKnownKrw: null,
        });
        continue;
      }
      const freight = q ? krw(q.freight! + q.surcharge, q.currency, fx) : null;
      const handling =
        q?.handling != null ? krw(q.handling, q.currency, fx) : null;
      if (freight === null) notes.push("국제운임 미확인");
      if (handling === null) notes.push("배송대행 필수 취급료 미확인");
      if (domestic === null) notes.push("현지 배송비 미확인");
      if (q?.status === "partial")
        notes.push("부피중량·추가 수수료 등 배송 조건 일부 미확인");
      const alcohol =
        !candidate.tariff && isAlcohol(candidate.profile)
          ? { ...classification.alcohol }
          : null;
      if (
        alcohol &&
        alcohol.bottles === null &&
        !/セット|まとめ|세트|bundle/i.test(
          [product.title, product.description].join(" "),
        )
      ) {
        alcohol.bottles = 1;
        notes.push("판매 구성 1병 가정: 병수 원문 미확인");
      }
      if (
        alcohol &&
        [alcohol.bottles, alcohol.mlPerBottle, alcohol.abv].some(
          (n) => n === null || n <= 0,
        )
      ) {
        scenarios.push({
          profile: candidate.profile,
          label: candidate.label,
          provider: q?.provider || "미정",
          scenario: entry.scenario,
          tax: null,
          reason: "주류 종류·병수·용량·도수 정보 부족",
          missingCosts: notes,
          knownTotalKrw: null,
          shippingKnownKrw: null,
        });
        continue;
      }
      const route = q?.method === "EMS" ? "postal_general" : "express";
      if (route === "postal_general")
        notes.push(
          "EMS 일반수입신고 세율 가정: 실제 간이통관 세액과 다를 수 있음",
        );
      const input: TaxCalculationInput = {
        profile: candidate.profile,
        route,
        personalUse: true,
        currency: "KRW",
        goods,
        domestic: domestic || "0",
        international: freight || "0",
        insurance: "0",
        additions: handling || "0",
        shippingSeparated: true,
        fx: {
          jpyToKrw: fx.jpyToKrw,
          usdToKrw: fx.usdToKrw,
          validFrom: fx.validFrom,
          validTo: fx.validTo,
          referenceDate: fx.referenceDate,
        },
        alcohol: alcohol
          ? {
              bottles: alcohol.bottles!,
              mlPerBottle: alcohol.mlPerBottle!,
              abv: alcohol.abv!,
            }
          : null,
      };
      // Including handling in the tax base is a conservative cost assumption, not a ruling on fee valuation.
      if (handling && Number(handling) > 0)
        notes.push("확인된 취급료를 과세가격 가산비용으로 포함한 가정");
      if (candidate.tariff)
        notes.push(
          "HSK 후보에 대한 기본세율(A)·부가세 10% 시나리오. 다른 양허·협정세율의 원산지·적용조건은 확인하지 않았습니다.",
        );
      const calculated = candidate.tariff
        ? calculateHskTax(input, candidate.tariff)
        : calculateTax(input);
      const tax = { ...calculated, fx: { ...fx, basis: fx.sourceKind } };
      const shippingKnownKrw =
        freight === null
          ? null
          : Number((decimal(freight) + decimal(handling || "0")) / SCALE);
      const sum =
        decimal(goods) +
        decimal(domestic || "0") +
        decimal(freight || "0") +
        decimal(handling || "0");
      scenarios.push({
        profile: candidate.profile,
        label: candidate.label,
        provider: q?.provider || "미정",
        scenario: entry.scenario,
        tax,
        reason: calculated.reason,
        missingCosts: notes,
        shippingKnownKrw,
        knownTotalKrw:
          calculated.totalTaxKrw === null
            ? null
            : Number(sum / SCALE) + calculated.totalTaxKrw,
      });
    }
  }
  const taxes = scenarios.flatMap((s) =>
      s.tax?.totalTaxKrw != null ? [s.tax.totalTaxKrw] : [],
    ),
    totals = scenarios.flatMap((s) =>
      s.knownTotalKrw != null ? [s.knownTotalKrw] : [],
    );
  const shipping = scenarios.flatMap((s) =>
    s.shippingKnownKrw !== null ? [s.shippingKnownKrw] : [],
  );
  const complete =
    scenarios.length > 0 &&
    taxes.length === scenarios.length &&
    missing.length === 0 &&
    scenarios.every((s) => s.missingCosts.length === 0);
  return {
    ...base,
    status: taxes.length
      ? complete
        ? "estimated"
        : "partial"
      : "needs_information",
    scenarios,
    taxRangeKrw: taxes.length
      ? { min: Math.min(...taxes), max: Math.max(...taxes) }
      : null,
    knownTotalRangeKrw: totals.length
      ? { min: Math.min(...totals), max: Math.max(...totals) }
      : null,
    shippingRangeKrw: shipping.length
      ? { min: Math.min(...shipping), max: Math.max(...shipping) }
      : null,
    rangeComplete: complete,
  };
}
