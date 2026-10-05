import type { PackageInput } from "./packaging";
import type { Product } from "./product";
export interface FxRate {
  base: string;
  quote: "KRW";
  rate: number;
  date: string;
  source: string;
  retrievedAt: string;
}
export interface RateBook {
  version: string;
  checkedAt: string;
  origin: string;
  destination: string;
  sources: string[];
  tenso: {
    method: string;
    currency: string;
    maxWeightGrams: number;
    maxLengthCm: number;
    maxLengthGirthCm: number;
    freight: number[][];
    handling: number[][];
  };
  malltail: {
    method: string;
    currency: string;
    membership: string;
    maxWeightGrams: number;
    fuelSurcharge: number;
    freight: number[][];
    volumetricPolicyVerified: boolean;
  };
}
export interface ShippingQuote {
  origin: string;
  destination: string;
  package: PackageInput;
  rateVersion: string;
  rateCheckedAt: string;
  sources: string[];
  rateStale: boolean;
  domesticShipping: Product["domesticShipping"];
  internationalDays: null;
  dispatchDays: Product["dispatchDays"];
  excluded: string[];
  estimated: boolean;
  provider: string;
  method: string;
  currency: string;
  status: string;
  freight: number | null;
  handling: number | null;
  surcharge: number;
  knownSubtotal: number | null;
  notes: string[];
  fx?: FxRate | null;
  convertedKnownSubtotal?: number | null;
}
export interface QuoteComparison {
  quotes: ShippingQuote[];
  comparisonReady: boolean;
  calculatedAt: string;
}
export interface PackageResearchResult {
  requiresReview?: boolean;
  package: PackageInput | null;
  reason: string;
  sources: string[];
  productWeightGrams?: number | null;
}
