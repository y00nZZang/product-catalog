import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { CatalogError } from "../../domain";

export const productHosts = new Set([
  "item.rakuten.co.jp",
  "books.rakuten.co.jp",
  "jp.mercari.com",
]);

export function publicIp(ip: string): boolean {
  try {
    const addr = ipaddr.process(ip);
    // Standard DNS64/NAT64 embeds an IPv4 destination. Validate that destination,
    // not just the translation prefix; private/loopback embedded addresses stay blocked.
    if (addr.kind() === "ipv6") {
      const bytes = addr.toByteArray();
      const prefix = [0, 100, 255, 155, 0, 0, 0, 0, 0, 0, 0, 0];
      if (prefix.every((byte, i) => bytes[i] === byte))
        return ipaddr.parse(bytes.slice(12).join(".")).range() === "unicast";
    }
    return addr.range() === "unicast";
  } catch {
    return false;
  }
}

export async function assertPublicUrl(raw: string, hosts?: Set<string>) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    (hosts && !hosts.has(u.hostname))
  )
    throw new CatalogError("unsafe_url");
  const addresses = await lookup(u.hostname, { all: true }).catch(() => {
    throw new CatalogError("dns_error", true);
  });
  if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
    throw new CatalogError("unsafe_address");
  return u;
}

export function retryAfter(value: string | undefined, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value) - now) || 0;
}

export function checkStatus(status: number, headers: Record<string, any> = {}) {
  if (status === 429)
    throw new CatalogError(
      "rate_limited",
      true,
      retryAfter(headers["retry-after"]),
    );
  if (status === 401 || status === 403) throw new CatalogError("access_denied");
  if (status === 404 || status === 410) throw new CatalogError("not_found");
  if (status >= 500) throw new CatalogError("upstream_error", true);
  if (status >= 400) throw new CatalogError("http_error");
}

export function rakutenAccessError(body: string): CatalogError {
  try {
    const payload = JSON.parse(body);
    if (payload?.errors?.errorMessage === "CLIENT_IP_NOT_ALLOWED") {
      return new CatalogError("rakuten_ip_not_allowed");
    }
  } catch {
    // Unknown responses remain generic; never expose arbitrary upstream text.
  }
  return new CatalogError("access_denied");
}

export function checkChallenge(html: string) {
  if (
    /<title[^>]*>\s*(Just a moment|Access Denied|Attention Required)/i.test(
      html,
    ) ||
    /id=["']challenge-form["']/.test(html)
  )
    throw new CatalogError("challenge");
}

export function classifyNetworkError(e: unknown): CatalogError {
  const error = e as { name?: string; cause?: { code?: string } };
  const code = error.cause?.code || "";
  if (code === "UND_ERR_INVALID_ARG")
    return new CatalogError("http_client_configuration_error");
  if (/CERT|TLS|SSL/.test(code)) return new CatalogError("tls_error");
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code))
    return new CatalogError("dns_error", true);
  if (error.name?.includes("Timeout") || /TIMEOUT/.test(code))
    return new CatalogError("timeout", true);
  return new CatalogError("network_error", true);
}
