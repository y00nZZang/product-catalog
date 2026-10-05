import { createHash } from "node:crypto";
import { fetch } from "undici";
import { dispatcher } from "../ingestion/network/http";
import { assertPublicUrl, checkStatus } from "../ingestion/network/policy";
import { CatalogError, errorCode } from "../domain";

// Only product-image CDNs observed in supported merchants, never arbitrary page URLs.
export const imageHosts = new Set([
  "static.mercdn.net",
  "thumbnail.image.rakuten.co.jp",
  "image.rakuten.co.jp",
  "shop.r10s.jp",
  "image.books.rakuten.co.jp",
  "books.r10s.jp",
]);
export interface PackageImage {
  url: string;
  hash: string;
  dataUrl: string;
}
export function selectImageUrls(urls: string[]) {
  return [...new Set(urls)]
    .filter((raw) => {
      try {
        const u = new URL(raw);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.port &&
          imageHosts.has(u.hostname)
        );
      } catch {
        return false;
      }
    })
    .slice(0, 3);
}
export async function loadPackageImage(raw: string): Promise<PackageImage> {
  let url = await assertPublicUrl(raw, imageHosts);
  // One timeout bounds redirects and body reads together; no retries on image failures.
  const signal = AbortSignal.timeout(10000);
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { dispatcher, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const location = res.headers.get("location");
      if (!location) throw new CatalogError("image_redirect_invalid");
      url = await assertPublicUrl(new URL(location, url).href, imageHosts);
      continue;
    }
    const reader = res.body?.getReader();
    if (!reader) throw new CatalogError("image_empty");
    try {
      checkStatus(res.status);
      const mime = res.headers.get("content-type")?.split(";")[0];
      if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime))
        throw new CatalogError("image_type_unsupported");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) throw new CatalogError("image_too_large");
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      const signature =
        mime === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216
          : mime === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP";
      if (!signature) throw new CatalogError("image_invalid");
      return {
        url: raw,
        hash: createHash("sha256").update(bytes).digest("hex"),
        dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      };
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  throw new CatalogError("image_redirect_limit");
}
export async function preparePackageImages(
  urls: string[],
  loader = loadPackageImage,
) {
  const selected = selectImageUrls(urls),
    images: PackageImage[] = [],
    warnings: string[] = [];
  if (!selected.length) warnings.push("no_supported_product_image");
  for (const url of selected) {
    try {
      images.push(await loader(url));
    } catch (e) {
      warnings.push(errorCode(e));
    }
  }
  return { images, warnings };
}
