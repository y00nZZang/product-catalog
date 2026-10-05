import { cachedFx, saveFx } from "../persistence/fx.repository";
import { safeGet } from "../ingestion/transport";
import { CatalogError } from "../domain";

import type { FxRate, ShippingQuote } from "../domain";
export async function getFx(base: string): Promise<FxRate> {
  if (!["JPY", "USD"].includes(base))
    throw new CatalogError("unsupported_fx_currency");
  const cached = await cachedFx(base);
  if (cached) return cached;
  const url = `https://api.frankfurter.dev/v2/rate/${base}/KRW`;
  const r = await safeGet(url, new Set(["api.frankfurter.dev"]));
  const data = JSON.parse(r.html);
  if (
    data.base !== base ||
    data.quote !== "KRW" ||
    typeof data.rate !== "number" ||
    data.rate <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
    Date.now() - Date.parse(data.date) > 10 * 86400000
  )
    throw new CatalogError("invalid_or_stale_fx");
  const result: FxRate = {
    base,
    quote: "KRW",
    rate: data.rate,
    date: data.date,
    source: url,
    retrievedAt: new Date().toISOString(),
  };
  await saveFx(base, result);
  return result;
}
export async function withConversions<T extends { quotes: ShippingQuote[] }>(
  data: T,
) {
  const quotes = [];
  for (const q of data.quotes) {
    try {
      const fx = await getFx(q.currency);
      quotes.push({
        ...q,
        fx,
        convertedKnownSubtotal:
          q.knownSubtotal == null
            ? null
            : Math.round(q.knownSubtotal * fx.rate),
      });
    } catch {
      quotes.push({ ...q, fx: null, convertedKnownSubtotal: null });
    }
  }
  return { ...data, quotes };
}
