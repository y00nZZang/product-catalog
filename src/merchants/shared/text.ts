import { load } from "cheerio";

export const clean = (s: unknown) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() || null : null;

export const amount = (s: unknown) => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(String(s).replace(/[,￥¥円\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function objects(v: any): any[] {
  if (!v || typeof v !== "object") return [];
  return [v, ...Object.values(v).flatMap(objects)];
}

export function extractText(html: string) {
  const $ = load(html);
  $("script,style,nav,footer,header,noscript").remove();
  const scoped = $(
    "#productInfo,#productDetailedDescription,[data-testid=description]",
  );
  return (
    scoped.length
      ? scoped.text()
      : $("main").length
        ? $("main").text()
        : $("body").text()
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18000);
}
