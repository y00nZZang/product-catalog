import { hskCalculationSchema, type HskCalculationInput } from "./schema";
import type { ResolvedTariff } from "./tariff/types";
import { tariffReviewReason, publicValueThreshold } from "./tariff/policy";
import { TARIFF_VERSION } from "./tariff/types";
import {
  taxCalculationSchema,
  type TaxInput,
  type TaxCalculationInput,
} from "./schema";
import { profiles, taxMetadata, type TaxProfileData } from "./profiles";
// Fixed point avoids a false tax boundary from binary floating point (JPY/USD conversion).
const SCALE = 1_000_000n;
export function decimal(s: string) {
  const [a, b = ""] = s.split(".");
  return BigInt(a) * SCALE + BigInt(b.padEnd(6, "0"));
}
const won = (v: bigint) => v / SCALE;
const tax = (v: bigint, rate: number) =>
  (v * decimal(String(rate))) / (100n * SCALE);
export function calculateTax(raw: TaxInput | TaxCalculationInput) {
  const input = taxCalculationSchema.parse(raw);
  return calculateResolved(input, profiles[input.profile], taxMetadata());
}
type CalculationMeta = Pick<
  ReturnType<typeof taxMetadata>,
  "version" | "checkedAt" | "reviewAfter" | "rateBasis" | "sources"
> &
  Record<string, unknown>;
export function calculateHskTax(raw: unknown, tariff: ResolvedTariff) {
  const input = hskCalculationSchema.parse(raw);
  const reason = tariffReviewReason(
    tariff.rate,
    tariff.internalTaxStatus,
    tariff.alternatives,
  );
  if (
    input.profile !== `hsk:${tariff.hsk}:A` ||
    tariff.rate.hsk !== tariff.hsk ||
    reason ||
    !tariff.eligible ||
    input.fx.referenceDate !== tariff.referenceDate ||
    input.fx.referenceDate < tariff.rate.validFrom ||
    input.fx.referenceDate > tariff.rate.validTo
  )
    throw new Error("unverified_public_tariff");
  const profile: TaxProfileData = {
    label: tariff.name,
    group: "공개 HSK 기본세율",
    duty: tariff.rate.rate!,
    liquor: 0,
    education: 0,
    excise: 0,
    officialItem: 0,
    rateEvidence: "official_public_A",
    calculationStatus: "supported",
    reviewReason: null,
    valueReviewThreshold: publicValueThreshold(tariff.hsk),
  };
  return calculateResolved(input, profile, {
    version: TARIFF_VERSION,
    checkedAt: tariff.referenceDate,
    reviewAfter: tariff.rate.validTo,
    rateBasis:
      "공개 HSK 기본세율(A)·일반 부가세 10% 가정. 양허/협정·개별 감면 미적용. 확정 세율/고지세액 아님.",
    sources: [tariff.source],
    hsk: tariff.hsk,
    rateType: "A",
    dutyRate: tariff.rate.rate,
    vatRate: 10,
    validFrom: tariff.rate.validFrom,
    validTo: tariff.rate.validTo,
    fetchedAt: tariff.fetchedAt,
  });
}
function calculateResolved(
  input: TaxCalculationInput | HskCalculationInput,
  p: TaxProfileData,
  meta: CalculationMeta,
) {
  const warnings = [
    meta.rateBasis,
    "원 단위 절사는 공식 예상세액 계산기 방식이며 실제 고지세액과 다를 수 있습니다.",
    "운송·통관 가능 여부와 세액 계산은 별도입니다.",
  ];
  const blocked = (reason: string) => ({
    status: "needs_review" as const,
    reason,
    exemption: null,
    taxes: null,
    totalTaxKrw: null,
    metadata: meta,
    warnings,
  });
  if (p.calculationStatus !== "supported")
    return blocked(p.reviewReason || "세부 품목 검토가 필요합니다.");
  if (!input.personalUse) return blocked("자가사용 외 수입은 미지원입니다.");
  if (input.route === "postal")
    return blocked(
      "EMS/국제우편의 간이세율·일반신고 구분은 추가 확인이 필요합니다. 특송 세율을 자동 적용하지 않습니다.",
    );
  if (input.route === "postal_general")
    warnings.push(
      "EMS·국제우편 일반수입신고 세율 가정입니다. 실제 간이세율과 다를 수 있으며 선택·신고를 실행한 것이 아닙니다.",
    );
  const f = input.fx,
    span = (Date.parse(f.validTo) - Date.parse(f.validFrom)) / 86400000;
  if (
    span < 0 ||
    span > 6 ||
    f.referenceDate < f.validFrom ||
    f.referenceDate > f.validTo
  )
    return blocked("과세환율 적용기간을 확인해주세요.");
  if (f.referenceDate < meta.checkedAt || f.referenceDate > meta.reviewAfter)
    return blocked("세율표 적용 시점을 재확인해야 합니다.");
  const jpy = decimal(f.jpyToKrw),
    usd = decimal(f.usdToKrw);
  if (jpy <= 0n || usd <= 0n) return blocked("양수인 과세환율을 입력해주세요.");
  const rate =
    input.currency === "JPY" ? jpy : input.currency === "USD" ? usd : SCALE;
  const cv = (s: string) => (decimal(s) * rate) / SCALE;
  const thresholdAmount =
    cv(input.goods) + cv(input.domestic) + cv(input.additions);
  const freight = cv(input.international) + cv(input.insurance);
  // Unknown separation cannot silently benefit from excluding freight from the exemption threshold.
  const exemptValue = input.shippingSeparated
    ? thresholdAmount
    : thresholdAmount + freight;
  const base = won(thresholdAmount + freight);
  if (base > 1_000_000_000_000n)
    return blocked("지원 계산 금액 상한을 초과했습니다.");
  if (base <= 0n) return blocked("실제 구입금액을 입력해주세요.");
  if (
    p.valueReviewThreshold !== null &&
    base * (100n * SCALE + decimal(String(p.duty))) >
      BigInt(p.valueReviewThreshold) * 100n * SCALE
  )
    return blocked("고가 물품의 추가 세목 검토가 필요합니다.");
  const alcohol = p.liquor > 0;
  if (alcohol && !input.alcohol)
    return blocked("주류의 병수·병당 용량·도수를 확인해주세요.");
  if (alcohol && input.alcohol!.abv <= 8.5)
    return blocked(
      "저도주·비알코올 및 특별 감면 조건은 별도 세율 확인이 필요합니다.",
    );
  const exemption =
    exemptValue <= 150n * usd &&
    (!alcohol ||
      (input.alcohol!.bottles === 1 && input.alcohol!.mlPerBottle <= 1000));
  const duty = exemption ? 0n : tax(base, p.duty);
  // Liquor and education tax survive low-value duty/VAT exemption.
  const liquor = tax(base + duty, p.liquor),
    education = tax(liquor, p.education);
  const vat = exemption ? 0n : tax(base + duty + liquor + education, 10);
  if (alcohol)
    warnings.push(
      "주류는 목록통관 제외·신고 및 배송사 취급 조건 확인 필요. 여행자 휴대품 면세와 다릅니다.",
    );
  if (!input.shippingSeparated)
    warnings.push(
      "국제운송비가 명백히 분리되지 않아 면세판정에 포함한 시나리오입니다.",
    );
  return {
    status: "estimated_basic_scenario" as const,
    reason: null,
    profile: input.profile,
    exemption,
    thresholdAmountKrw: Number(exemptValue) / 1e6,
    thresholdUsd: 150,
    taxableValueKrw: Number(base),
    taxes: {
      duty: Number(duty),
      liquor: Number(liquor),
      education: Number(education),
      vat: Number(vat),
    },
    totalTaxKrw: Number(duty + liquor + education + vat),
    metadata: meta,
    warnings,
    fx: { ...f, basis: "user_entered_customs_rate_not_independently_verified" },
    calculation: "관세→(과세가격+관세)의 주세→주세의 교육세→합산금액의 부가세",
    input,
  };
}
