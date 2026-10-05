export const TARIFF_VERSION = "kr-public-hsk-basic-v1";
export const TARIFF_SOURCE =
  "https://unipass.customs.go.kr/clip/hsinfosrch/openULS0401009Q.do";
export interface PublishedRate {
  hsk: string;
  name: string;
  type: string;
  rate: number | null;
  rawRate: string;
  unitAmount: string | null;
  validFrom: string;
  validTo: string;
}
export interface HskOption {
  hsk: string;
  name: string;
  path: string[];
}
export interface TariffSnapshot {
  version: string;
  source: string;
  referenceDate: string;
  fetchedAt: string;
  prefix: string;
  rates: PublishedRate[];
  options: HskOption[];
}
export interface ResolvedTariff {
  hsk: string;
  name: string;
  rate: PublishedRate;
  alternatives: PublishedRate[];
  internalTaxStatus: "none_listed" | "review" | "unknown";
  internalTaxText: string;
  eligible: boolean;
  reason: string | null;
  source: string;
  fetchedAt: string;
  referenceDate: string;
  rationale: string;
}
export interface TariffResolution {
  version: string;
  referenceDate: string;
  window: number;
  status: "available" | "needs_review" | "unavailable";
  candidates: ResolvedTariff[];
  missingInformation: string[];
}
export const tariffWindow = () => Math.floor(Date.now() / (6 * 60 * 60 * 1000));
