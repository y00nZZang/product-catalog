import { load } from "cheerio";
import { safeGet } from "../ingestion/transport";
import { CatalogError } from "../domain";
import {
  readCustomsFx,
  writeCustomsFx,
} from "../persistence/customs-fx.repository";
export const FX_PAGE =
  "https://unipass.customs.go.kr/clip/com/bsopcomn/baseinfo/otsd/COM0101049Q.do";
const PUBLIC_QUERY =
  "https://unipass.customs.go.kr/clip/com/bsopcomn/baseinfo/retrieveCOM0101049Q.do";
const API_URL =
  "https://apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo";
export function koreaDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}
export function day(s: string) {
  const x = s.replaceAll("-", "");
  if (!/^\d{8}$/.test(x)) throw new CatalogError("customs_fx_invalid_date");
  const d = `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
  if (
    Number.isNaN(Date.parse(d)) ||
    new Date(d).toISOString().slice(0, 10) !== d
  )
    throw new CatalogError("customs_fx_invalid_date");
  return d;
}
export function weekStart(date: string) {
  const d = new Date(day(date) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function weekEnd(from: string) {
  return new Date(Date.parse(from) + 6 * 86400000).toISOString().slice(0, 10);
}
export interface CustomsFx {
  jpyToKrw: string;
  usdToKrw: string;
  validFrom: string;
  validTo: string;
  referenceDate: string;
  source: string;
  sourceKind: "official_api" | "official_public";
  retrievedAt: string;
  warnings: string[];
}
function rate(value: unknown) {
  const s = String(value);
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(s) || Number(s) <= 0)
    throw new CatalogError("customs_fx_invalid_rate");
  return s;
}
export function validateFx(data: CustomsFx, date: string): CustomsFx {
  day(date);
  day(data.validFrom);
  day(data.validTo);
  if (
    data.validFrom !== weekStart(date) ||
    data.validTo !== weekEnd(data.validFrom)
  )
    throw new CatalogError("customs_fx_stale");
  return {
    ...data,
    jpyToKrw: rate(data.jpyToKrw),
    usdToKrw: rate(data.usdToKrw),
    referenceDate: date,
  };
}
export function parseApiFx(xml: string, date: string): CustomsFx {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new CatalogError("customs_fx_invalid_response");
  const $ = load(xml, { xmlMode: true });
  if ($("resultCode").text().trim() !== "00")
    throw new CatalogError("customs_fx_api_error");
  const rows = $("currSgn")
    .toArray()
    .map((el) => {
      const p = $(el).parent();
      return {
        currency: $(el).text().trim(),
        from: p.find("aplyBgnDt").text().trim(),
        value: p.find("fxrt").text().trim(),
        type: p.find("imexTp").text().trim(),
      };
    });
  const get = (currency: string) => {
    const found = rows.filter((r) => r.currency === currency && r.type === "2");
    if (found.length !== 1 || day(found[0].from) !== weekStart(date))
      throw new CatalogError("customs_fx_missing_currency");
    return rate(found[0].value);
  };
  return validateFx(
    {
      jpyToKrw: get("JPY"),
      usdToKrw: get("USD"),
      validFrom: weekStart(date),
      validTo: weekEnd(weekStart(date)),
      referenceDate: date,
      source: API_URL,
      sourceKind: "official_api",
      retrievedAt: new Date().toISOString(),
      warnings: [],
    },
    date,
  );
}
export function parsePublicFx(
  html: string,
  json: unknown,
  date: string,
): CustomsFx {
  const $ = load(html),
    from = day(String($("#aplyStrtDd").val() || "")),
    to = day(String($("#aplyEndDd").val() || ""));
  const rows = (
    json as {
      items?: { currCd?: string; aplyBgnDt?: string; weekFxrtIm?: string }[];
    }
  )?.items;
  if (!Array.isArray(rows))
    throw new CatalogError("customs_fx_invalid_response");
  const get = (currency: string) => {
    const found = rows.filter((r) => r.currCd === currency);
    if (found.length !== 1 || day(found[0].aplyBgnDt || "") !== from)
      throw new CatalogError("customs_fx_missing_currency");
    return rate(found[0].weekFxrtIm);
  };
  return validateFx(
    {
      jpyToKrw: get("JPY"),
      usdToKrw: get("USD"),
      validFrom: from,
      validTo: to,
      referenceDate: date,
      source: FX_PAGE,
      sourceKind: "official_public",
      retrievedAt: new Date().toISOString(),
      warnings: [],
    },
    date,
  );
}
const inFlight = new Map<string, Promise<CustomsFx>>();
export async function getCustomsFx(
  date = koreaDate(),
  fetcher = safeGet,
): Promise<CustomsFx> {
  date = day(date);
  const cached = await readCustomsFx(weekStart(date));
  for (const data of cached) {
    try {
      return validateFx(data, date);
    } catch {
      /* Old or malformed cache never becomes a current quote. */
    }
  }
  const key = weekStart(date);
  const existing = inFlight.get(key);
  if (existing) return validateFx(await existing, date);
  const work = (async () => {
    let data: CustomsFx | undefined;
    const warnings: string[] = [];
    if (process.env.CUSTOMS_API_KEY) {
      try {
        const url = new URL(API_URL);
        url.searchParams.set("serviceKey", process.env.CUSTOMS_API_KEY);
        url.searchParams.set("aplyBgnDt", key.replaceAll("-", ""));
        url.searchParams.set("weekFxrtTpcd", "2");
        data = parseApiFx(
          (await fetcher(url.href, new Set(["apis.data.go.kr"]))).html,
          date,
        );
      } catch {
        warnings.push(
          "공식 API 조회 실패로 관세청 공개 주간환율 조회를 사용했습니다.",
        );
      }
    }
    if (!data) {
      const page = await fetcher(FX_PAGE, new Set(["unipass.customs.go.kr"]));
      const $ = load(page.html);
      const url = new URL(PUBLIC_QUERY);
      for (const [k, v] of Object.entries({
        aplyBgnDt: date,
        aplyStrtDd: String($("#aplyStrtDd").val() || ""),
        aplyEndDd: String($("#aplyEndDd").val() || ""),
        summary: "01",
        pageIndex: "1",
        pageUnit: "100",
      }))
        url.searchParams.set(k, v);
      data = parsePublicFx(
        page.html,
        JSON.parse(
          (await fetcher(url.href, new Set(["unipass.customs.go.kr"]))).html,
        ),
        date,
      );
    }
    data.warnings = warnings;
    await writeCustomsFx(data);
    return data;
  })();
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}
