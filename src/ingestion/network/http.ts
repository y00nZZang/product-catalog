import { lookup } from "node:dns/promises";
import { Agent, fetch, type RequestInit } from "undici";
import { config } from "../../config";
import { CatalogError, identify, type Identity } from "../../domain";
import {
  publicIp,
  productHosts,
  assertPublicUrl,
  checkStatus,
  rakutenAccessError,
  checkChallenge,
  classifyNetworkError,
} from "./policy";

export const dispatcher = new Agent({
  connect: {
    lookup: (hostname, options, cb) => {
      lookup(hostname, { all: true })
        .then((addresses) => {
          if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
            return cb(new Error("unsafe_address"), [], 4);
          // Pin the validated resolution used by the actual connection (DNS rebinding protection).
          if ((options as any).all) (cb as any)(null, addresses);
          else cb(null, addresses[0].address, addresses[0].family);
        })
        .catch((e) => cb(e, [], 4));
    },
  },
});

export async function safeGet(
  raw: string,
  hosts: Set<string> = productHosts,
  headers: Record<string, string> = {},
  identity?: Identity,
) {
  let u = await assertPublicUrl(raw, hosts);
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (identity && identify(u.href).key !== identity.key)
      throw new CatalogError("redirect_identity_changed");
    try {
      const res = await fetch(u.href, {
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: {
          "user-agent": "ProductCatalogResearch/0.1",
          accept: "text/html,application/json",
          ...headers,
        },
      } as RequestInit & { dispatcher: Agent });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const location = res.headers.get("location");
        if (!location) throw new CatalogError("invalid_redirect");
        u = await assertPublicUrl(new URL(location, u).href, hosts);
        continue;
      }
      try {
        checkStatus(res.status, Object.fromEntries(res.headers));
      } catch (e) {
        if (res.status === 403 && u.hostname === "openapi.rakuten.co.jp") {
          const reader = res.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            if (reader) {
              while (size <= 4096) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size <= 4096) chunks.push(value);
              }
            }
          } catch {
            throw e;
          } finally {
            await reader?.cancel().catch(() => {});
          }
          throw size <= 4096
            ? rakutenAccessError(Buffer.concat(chunks).toString("utf8"))
            : e;
        }
        await res.body?.cancel();
        throw e;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.body?.getReader();
      if (!reader) throw new CatalogError("empty_response");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 3_000_000) {
          await reader.cancel();
          throw new CatalogError("response_too_large");
        }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      const contentType = res.headers.get("content-type") || "text/html";
      const encoding =
        contentType.match(/charset=([\w-]+)/i)?.[1] ||
        bytes
          .subarray(0, 300)
          .toString()
          .match(/encoding=["']([\w-]+)/i)?.[1] ||
        "utf-8";
      let html: string;
      try {
        html = new TextDecoder(encoding).decode(bytes);
      } catch {
        throw new CatalogError("unsupported_encoding");
      }
      checkChallenge(html);
      if (
        /<title[^>]*>[^<]*(お探しのページが見つかりません|ページが見つかりません|商品が見つかりません)/i.test(
          html,
        )
      )
        throw new CatalogError("soft_not_found");
      return { html, url: u.href, status: res.status, contentType };
    } catch (e) {
      if (e instanceof CatalogError) throw e;
      throw classifyNetworkError(e);
    }
  }
  throw new CatalogError("too_many_redirects");
}
