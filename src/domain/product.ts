/** Normalized seller data. A missing value is deliberately distinct from zero. */

export type Platform = "rakuten" | "mercari";

export interface Evidence {
  source: string;
  method: string;
  excerpt?: string;
}

export interface Product {
  conversion?: import("./shipping").FxRate & { amount: number };
  apiItemCode?: string;
  apiBooksCode?: string;
  sourceType?: string;
  priceRange?: { min: number; max: number; currency: string };
  title: string | null;
  description: string | null;
  translatedTitle: string | null;
  language: string;
  seller: string | null;
  category: string | null;
  images: string[];
  price: number | null;
  currency: string | null;
  availability: "in_stock" | "sold_out" | "preorder" | "backorder" | "unknown";
  condition: string | null;
  identifiers: string[];
  options: string | null;
  quantity: number | null;
  contents: string | null;
  domesticShipping: {
    amount: number | null;
    currency: string | null;
    condition: string | null;
    payer: string | null;
  };
  dispatchDays: { min: number; max: number } | null;
  evidence: Record<string, Evidence>;
  warnings: string[];
}

export function emptyProduct(): Product {
  return {
    title: null,
    description: null,
    translatedTitle: null,
    language: "ja",
    seller: null,
    category: null,
    images: [],
    price: null,
    currency: null,
    availability: "unknown",
    condition: null,
    identifiers: [],
    options: null,
    quantity: null,
    contents: null,
    domesticShipping: {
      amount: null,
      currency: null,
      condition: null,
      payer: null,
    },
    dispatchDays: null,
    evidence: {},
    warnings: [],
  };
}
