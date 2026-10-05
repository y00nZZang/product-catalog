import { fetch } from "undici";
import { load } from "cheerio";
import { dispatcher } from "../../ingestion/network/http";
import { checkStatus } from "../../ingestion/network/policy";
import { CatalogError } from "../../domain";
import { day } from "../fx";
import { cachedTariff } from "../../persistence/tariff.repository";
import {
  TARIFF_VERSION,
  TARIFF_SOURCE,
  tariffWindow,
  type PublishedRate,
  type HskOption,
  type TariffSnapshot,
} from "./types";
const origin = "https://unipass.customs.go.kr";
const history = "/clip/hsinfosrch/retrieveTrifHistSrchLst.do";
export type OfficialPost = (
  path: string,
  params: Record<string, string>,
) => Promise<string>;
export const officialPost: OfficialPost = async (path, params) => {
  const r = await fetch(origin + path, {
    method: "POST",
    dispatcher,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "ProductCatalogResearch/0.1",
    },
    body: new URLSearchParams(params),
  });
  try {
    checkStatus(r.status, Object.fromEntries(r.headers));
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const b of r.body!) {
      size += b.length;
      if (size > 2_000_000) throw new CatalogError("tariff_response_too_large");
      chunks.push(b);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await r.body?.cancel().catch(() => {});
  }
};
export function parseRatePage(raw: string, prefix: string, date: string) {
  const d = JSON.parse(raw);
  const total: unknown = d.paginationInfo?.totalRecordCount;
  if (
    typeof total !== "number" ||
    !Number.isInteger(total) ||
    total < 0 ||
    !Array.isArray(d.trifHistLst)
  )
    throw new CatalogError("tariff_schema_changed");
  const rates: PublishedRate[] = d.trifHistLst
    .map((r: any) => {
      if (
        !/^\d{10}$/.test(r.hsSgn) ||
        !r.hsSgn.startsWith(prefix) ||
        typeof r.korePrlstNm !== "string" ||
        typeof r.trrtTpcd !== "string"
      )
        throw new CatalogError("tariff_identity_mismatch");
      const from = day(r.hsSgnAplyStrtDt),
        to = day(r.hsSgnAplyEndDt);
      const value = String(r.trrt ?? "").trim();
      return {
        hsk: r.hsSgn,
        name: r.korePrlstNm.trim(),
        type: r.trrtTpcd,
        rawRate: value,
        rate: /^\d{1,4}(\.\d{1,6})?$/.test(value) ? Number(value) : null,
        unitAmount: String(r.prutXamt ?? "").trim() || null,
        validFrom: from,
        validTo: to,
      };
    })
    .filter((r: PublishedRate) => r.validFrom <= date && date <= r.validTo);
  return {
    total,
    rates,
    rawCount: d.trifHistLst.length,
    page: d.paginationInfo.currentPageNo,
  };
}
export async function fetchRates(
  prefix: string,
  date: string,
  type: string,
  post: OfficialPost = officialPost,
) {
  if (!/^(\d{6}|\d{10})$/.test(prefix))
    throw new CatalogError("invalid_hsk_prefix");
  const rates: PublishedRate[] = [];
  let expected: number | undefined;
  let received = 0;
  for (let page = 1; page <= 10; page++) {
    const d = parseRatePage(
      await post(history, {
        hsSgn: prefix,
        trrtTpcd: type,
        chkIclnHist: "",
        pageIndex: String(page),
        pageUnit: "100",
      }),
      prefix,
      date,
    );
    if (d.page !== page) throw new CatalogError("tariff_pagination_changed");
    if (expected !== undefined && d.total !== expected)
      throw new CatalogError("tariff_pagination_changed");
    expected = d.total;
    received += d.rawCount;
    rates.push(...d.rates);
    if (received === expected) return rates;
    if (received > expected || !d.rawCount)
      throw new CatalogError("tariff_pagination_incomplete");
  }
  throw new CatalogError("tariff_lookup_too_broad");
}
export function parseHskOptions(
  html: string,
  prefix: string,
  rates: PublishedRate[],
): HskOption[] {
  const $ = load(html);
  const nodes: { code: string; name: string }[] = [];
  $("#tblLstBody tr").each((_, el) => {
    const code = String($(el).find('[name="hsSgn_Mn"]').val() || "");
    const name = $(el).find("td").eq(3).text().trim().replace(/\s+/g, " ");
    if (/^\d{6,10}$/.test(code) && code.startsWith(prefix) && name)
      nodes.push({ code, name });
  });
  const codes = [...new Set(rates.map((r) => r.hsk))];
  return codes.map((hsk) => {
    const leaf = nodes.find((n) => n.code === hsk);
    if (!leaf) throw new CatalogError("hsk_hierarchy_incomplete");
    return {
      hsk,
      name: leaf.name,
      path: nodes
        .filter((n) => n.code.length < 10 && hsk.startsWith(n.code))
        .sort((a, b) => a.code.length - b.code.length)
        .map((n) => n.name)
        .concat(leaf.name),
    };
  });
}
export async function tariffSnapshot(
  prefix: string,
  date: string,
  post: OfficialPost = officialPost,
): Promise<TariffSnapshot> {
  const rates = await fetchRates(prefix, date, "A", post);
  const html = await post("/clip/hsinfosrch/openULS0201005Q.do", {
    cntyCd: "KR",
    aplyYy: date.slice(0, 4),
    searchVal: prefix,
  });
  return {
    version: TARIFF_VERSION,
    source: TARIFF_SOURCE,
    referenceDate: date,
    fetchedAt: new Date().toISOString(),
    prefix,
    rates,
    options: parseHskOptions(html, prefix, rates),
  };
}
export const getTariffSnapshot = (prefix: string, date: string) =>
  cachedTariff(`${TARIFF_VERSION}:${date}:${tariffWindow()}:${prefix}`, () =>
    tariffSnapshot(prefix, date),
  );
export function parseInternalTax(html: string, hsk: string) {
  const $ = load(html);
  if (String($('[name="tmpSearchVal"]').val()) !== hsk)
    throw new CatalogError("tariff_detail_identity_mismatch");
  const row = $('a[href="itxCten"]').closest("tr");
  const text = row.find("td").last().text().trim().replace(/\s+/g, " ");
  return {
    internalTaxStatus:
      (/^(There were no results found\.|조회된 자료가 없습니다\.?|조회된 데이터가 없습니다\.?)$/.test(
        text,
      )
        ? "none_listed"
        : text
          ? "review"
          : "unknown") as "none_listed" | "review" | "unknown",
    internalTaxText: text,
  };
}
export const getTariffDetail = (hsk: string, date: string) =>
  cachedTariff(
    `${TARIFF_VERSION}:detail:${date}:${tariffWindow()}:${hsk}`,
    async () => {
      if (!/^\d{10}$/.test(hsk)) throw new CatalogError("invalid_hsk");
      const alternatives = await fetchRates(hsk, date, "", officialPost);
      const html = await officialPost("/clip/hsinfosrch/openULS0201007Q.do", {
        searchVal: hsk,
        aplyYy: date.slice(0, 4),
        cntyCd: "KR",
      });
      return { alternatives, ...parseInternalTax(html, hsk) };
    },
  );
