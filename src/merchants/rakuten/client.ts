import { load } from "cheerio";
import { CatalogError, type Product, type Identity } from "../../domain";
import { safeGet } from "../../ingestion/transport";
import { Recorder } from "../../jobs/recorder";
import { parseHtml } from "../html";
import { parseBooksApi, resolveBooksCode } from "./books";
import { parseRakutenApi, resolveRakutenItemCode } from "./ichiba";

export const RAKUTEN_ENDPOINTS = {
  ichiba:
    "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701",
  books:
    "https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404",
};

function keywordFromTitle(title: string) {
  let s = "";
  for (const c of title) {
    if (Buffer.byteLength(s + c, "utf8") > 120) break;
    s += c;
  }
  return s;
}

export async function collectRakuten(
  id: Identity,
  previous: Product | undefined,
  rec: Recorder,
  fetcher: typeof safeGet = safeGet,
) {
  let sourceHtml: string | undefined;
  let observedAt = new Date();
  const books = id.externalId.startsWith("books:");
  let code: string | null = null;
  let keyword: string | null = null;
  if (books) {
    code =
      previous?.apiBooksCode && /^\d{13}$/.test(previous.apiBooksCode)
        ? previous.apiBooksCode
        : null;
  } else {
    const value = previous?.apiItemCode;
    const shop = id.externalId.split(":")[0];
    code =
      value?.startsWith(shop + ":") &&
      /^\d+$/.test(value.slice(shop.length + 1))
        ? value
        : null;
  }
  const readPage = async () => {
    if (sourceHtml === undefined) {
      sourceHtml = (
        await rec.step("fetch", "http", "rakuten", () =>
          fetcher(id.canonicalUrl, undefined, {}, id),
        )
      ).html;
      observedAt = new Date();
    }
    return sourceHtml;
  };
  if (!code) {
    const html = await readPage();
    code = await rec.step("resolve_api_code", "html", "rakuten", async () =>
      books ? resolveBooksCode(html) : resolveRakutenItemCode(html, id),
    );
    if (books && !code) {
      const $ = load(html);
      const title = $('meta[property="og:title"]').attr("content");
      if (title) keyword = keywordFromTitle(title);
    }
  }
  if (!code && !keyword)
    return {
      product: null,
      sourceHtml,
      observedAt,
      warning: "api_identifier_unresolved",
    };
  const api = new URL(
    books ? RAKUTEN_ENDPOINTS.books : RAKUTEN_ENDPOINTS.ichiba,
  );
  api.searchParams.set("applicationId", process.env.RAKUTEN_APPLICATION_ID!);
  api.searchParams.set("formatVersion", "2");
  api.searchParams.set("availability", "0");
  if (books) {
    api.searchParams.set("outOfStockFlag", "1");
    api.searchParams.set(code ? "isbnjan" : "keyword", code || keyword!);
  } else api.searchParams.set("itemCode", code!);
  try {
    const r = await rec.step(
      "fetch",
      books ? "books_api" : "ichiba_api",
      "rakuten",
      () =>
        fetcher(api.href, new Set(["openapi.rakuten.co.jp"]), {
          accessKey: process.env.RAKUTEN_ACCESS_KEY!,
        }),
    );
    observedAt = new Date();
    const product = await rec.step(
      "parse",
      books ? "rakuten_books_api" : "rakuten_ichiba_api",
      "rakuten",
      async () =>
        books
          ? parseBooksApi(JSON.parse(r.html), id, code)
          : parseRakutenApi(JSON.parse(r.html), id, code!),
    );
    product.sourceType = books ? "rakuten_books_api" : "rakuten_ichiba_api";
    // Supplement only stable HTML details; never replace the API's current price or stock with stale page data.
    if (sourceHtml) {
      try {
        const supplemental = parseHtml(sourceHtml, id);
        if (!product.description)
          product.description = supplemental.description;
        product.identifiers = [
          ...new Set([...product.identifiers, ...supplemental.identifiers]),
        ];
        if (!product.condition) product.condition = supplemental.condition;
      } catch {}
    }
    return { product, sourceHtml, observedAt, apiBody: r.html, warning: null };
  } catch (e) {
    if (e instanceof CatalogError && e.code === "api_item_not_found")
      return {
        product: null,
        sourceHtml,
        observedAt,
        warning: "api_item_not_found",
      };
    throw e;
  }
}
