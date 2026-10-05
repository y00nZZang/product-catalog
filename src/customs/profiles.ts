import { TARIFF_VERSION, TARIFF_SOURCE } from "./tariff/types";
import hsCatalog from "./data/hs2022.json";
import catalog from "./data/catalog-2026-09-30.json";
import {
  calculationProfiles,
  reviewReason,
  valueReviewThreshold,
} from "./profile-policy";
export const TAX_VERSION = "kr-jp-calculator-catalog-2026-09-30.3";
export const TAX_SOURCES = [
  catalog.source,
  catalog.scriptSource,
  "https://www.customs.go.kr/incheon_airport/cm/cntnts/cntntsView.do?cntntsId=6719&mi=12713",
];
export interface TaxProfileData {
  label: string;
  group: string;
  duty: number;
  liquor: number;
  education: number;
  excise: number;
  officialItem: number;
  rateEvidence: string;
  calculationStatus: "supported" | "needs_review";
  reviewReason: string | null;
  valueReviewThreshold: number | null;
}
/** Catalog covers the retrieved calculator menu, not all HSK codes. Unknown items have NO default tax rate. */
export const profiles: Record<string, TaxProfileData> = Object.fromEntries(
  catalog.items.map((row) => {
    const reason = reviewReason(row.officialItem, row.group);
    return [
      calculationProfiles[row.officialItem] || `catalog_${row.officialItem}`,
      {
        ...row,
        label: row.officialItem === 46 ? "완구 (장식 조형물 제외)" : row.label,
        calculationStatus: reason ? "needs_review" : "supported",
        reviewReason: reason,
        valueReviewThreshold: valueReviewThreshold(row.officialItem),
      },
    ];
  }),
);
export type TaxProfile = keyof typeof profiles;
export const profileIds = Object.keys(profiles) as [string, ...string[]];
export function isAlcohol(id: TaxProfile) {
  return profiles[id]?.liquor > 0;
}
export const taxMetadata = () => ({
  profiles,
  publicHsk: {
    version: TARIFF_VERSION,
    source: TARIFF_SOURCE,
    cacheHours: 6,
    calculationScope: "basic_A_standard_VAT_scenarios",
  },
  version: TAX_VERSION,
  checkedAt: catalog.checkedAt,
  reviewAfter: "2026-10-30",
  sources: TAX_SOURCES,
  coverage: {
    catalogItems: catalog.items.length,
    calculableProfiles: Object.values(profiles).filter(
      (p) => p.calculationStatus === "supported",
    ).length,
    reviewProfiles: Object.values(profiles).filter(
      (p) => p.calculationStatus === "needs_review",
    ).length,
    completeHskCoverage: false,
    hs6: {
      ...hsCatalog.counts,
      version: hsCatalog.version,
      source: hsCatalog.source,
    },
  },
  rateBasis:
    "관세청 계산기 품목별 기본세율 가정: 실제 적용세율·HSK 확정 아님. 협정·특혜세율 미적용. 검토 품목은 세액 계산 중단.",
  fxSource:
    "https://unipass.customs.go.kr/clip/com/bsopcomn/baseinfo/otsd/COM0101049Q.do",
});
