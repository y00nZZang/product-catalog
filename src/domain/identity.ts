import { createHash } from "node:crypto";
import { CatalogError } from "./errors";
import type { Platform } from "./product";

/** URL normalization must preserve option parameters: two options may have different prices. */

export interface Identity {
  platform: Platform;
  externalId: string;
  canonicalUrl: string;
  key: string;
  options: string;
}

export function identify(input: string): Identity {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new CatalogError("invalid_url");
  }
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    input.length > 2048
  )
    throw new CatalogError("unsupported_url");
  let platform: Platform;
  let externalId: string;
  const segments = u.pathname.split("/").filter(Boolean);
  if (
    u.hostname === "item.rakuten.co.jp" &&
    segments.length === 2 &&
    segments.every((s) => /^[\w-]+$/.test(s))
  ) {
    platform = "rakuten";
    externalId = segments.join(":");
    u.pathname = `/${segments.join("/")}/`;
  } else if (
    u.hostname === "books.rakuten.co.jp" &&
    /^\/rb\/\d+\/?$/.test(u.pathname)
  ) {
    platform = "rakuten";
    externalId = `books:${segments[1]}`;
    u.pathname = `/rb/${segments[1]}/`;
  } else if (
    u.hostname === "jp.mercari.com" &&
    /^\/item\/m\d+\/?$/.test(u.pathname)
  ) {
    platform = "mercari";
    externalId = segments[1];
    u.pathname = `/item/${externalId}`;
  } else throw new CatalogError("unsupported_url");
  // Remove known tracking keys only; preserve unknown query keys, including options.
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|scid$|s-id$|l-id$|srsltid$|gclid$|fbclid$|ref$)/i.test(k))
      u.searchParams.delete(k);
  if (
    u.hostname === "books.rakuten.co.jp" &&
    u.searchParams.get("bkts") === "1"
  )
    u.searchParams.delete("bkts");
  u.searchParams.sort();
  u.hash = "";
  const options = u.searchParams.toString();
  return {
    platform,
    externalId,
    canonicalUrl: u.href,
    options,
    key: createHash("sha256")
      .update(`${platform}:${externalId}:${options}`)
      .digest("hex"),
  };
}

export const ttlSeconds = (p: Platform) => (p === "rakuten" ? 21600 : 3600);
