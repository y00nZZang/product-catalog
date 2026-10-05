import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { load } from "cheerio";
import { safeGet } from "../../src/ingestion/transport";
import { identify, errorCode } from "../../src/domain";
const ids =
  `d748be6694f303a4f8bdb264f89346e7 fe971fe9fa0d781655a7e8aa076f8a60 ecc8be592c91b858c1dce71381d8c7aa e84a82dc2bc9065949954101592c3957 e6da38f98aef2fc126d0cffbcf717ad6 c9fb3af649c7c8c442cbf934f2efb4dd a256314ebd4cd7e2694bdcc077a9ed21 b0b3a0a69d236c09ca0cd56aafa612a7 e507bb491f7700668d3f49ee19a64b6a 24c6ec6c7a3309f94d9715d55ef2f0c5 57ea9d08a481f4a6c1d1e6c31b46c8b4 6491d9f40c4553a112de1e5df20d81d8 c53daebbcb9d3dba03e8d7369e815fbd beef5b723d52e8395b528723b044fa9e c6e75b37e9b9f82068e8f6ebd9d010ed 41e1df5598e17285dd54859cf5aabed9 ed2f1b1595420526b2abcb3c01294c0d fa0e73e1b1f9d55e1837683409f9ac63 b711e386938065e7ba830f31510c2099 660b466a1688a3e11aadc44e3d245f01 d1ba8edafced432caf2d55745cf11b11 825c326026319ad7dc5f0c609053010c 4d8e5ea8a3f1439b7ee40797353fc5a3 dd72ac4d5d01da9ff476c2f49431c529 a7c388cf2781e126c16e85b52a277941 7f348886edab08b9177227e7d1a0be53 3bac6f1e6d5f558ca5f7b6bd7e24e96f de68ec968f7a55dbc5c6f86e22cd580c b96bbf31aed68689d6ad789efb21719d 52133c375949d05016b56014be4715c6 465a28d59d6adabdce2c502dd2d2217f 53c5ddb8260d910fe7fce4e9ad128312 32b3e4d394a344f4b12f32fb2943f25c 98c9326aa78e29cb349033345d8d9f67 ef5101bdbae8ef79dadcfc61dcd234c5 ed44526419871f3a5f52be19db875e9f 5fc18dad7dd8db61746687208a817b29 8b4ab9228a745eb698f10154280e09fb eae5254a434a27144e7da2eed2adb31f afd22e478408e409aa9131f61b5222c9 839a06d826c9d72ebdc94ef6792ae2b2 b9a16d3f434e14e60275d3715e6f24d0 dcc8b5b42cf23459a344b38e1341dec5 bfa9cfcf028ce52a17cce1d967e2985f 7f2f29a714e37eb1833958474f35be0d 8c34674528a8b0984a5d2185b74eaff2 d1758fa1634dd9f29a492e320cac8f16 8a675b0d31b706208beac88ab0a682c4 0afcd8f69a06edffefaf4d3b2f8ebec3 f09475c2c4a8ae6018b6fe4bce3f7a7a`.split(
    " ",
  );
(async () => {
  mkdirSync("docs/evidence", { recursive: true });
  const file = "docs/evidence/sazo-sample-discovery-2026-09-22.json";
  let rows: any[] = [];
  try {
    rows = JSON.parse(readFileSync(file, "utf8")).candidates;
  } catch {}
  for (const id of ids) {
    const source = "https://sazo.kr/detail/" + id;
    if (rows.some((r) => r.discoveryUrl === source)) continue;
    if (rows.filter((r) => r.platform === "mercari").length >= 30) break;
    try {
      const r = await safeGet(source, new Set(["sazo.kr"]));
      const $ = load(r.html);
      const links = $("a[href]")
        .map((_, a) => $(a).attr("href"))
        .get()
        .filter(Boolean);
      const url = links.find((x) =>
        /^https:\/\/(jp\.mercari\.com\/item\/|item\.rakuten\.co\.jp\/|books\.rakuten\.co\.jp\/rb\/)/.test(
          x,
        ),
      );
      if (url) {
        const ident = identify(url);
        rows.push({
          discoveryUrl: source,
          url: ident.canonicalUrl,
          platform: ident.platform,
          discoveredAt: new Date().toISOString(),
        });
      } else
        rows.push({
          discoveryUrl: source,
          status: "unsupported_or_no_public_source_link",
        });
    } catch (e) {
      rows.push({ discoveryUrl: source, status: errorCode(e) });
    }
    writeFileSync(
      file,
      JSON.stringify(
        {
          discoverySource:
            "https://sazo.kr/ → 지금 검색되고 있는 상품 → 더보기",
          scope:
            "One bounded snapshot of 50 public product cards. No user/session identifiers, cookies, authentication or private API data collected.",
          candidates: rows,
        },
        null,
        2,
      ),
    );
    console.log(rows.length, rows.at(-1)?.platform || rows.at(-1)?.status);
    await new Promise((r) => setTimeout(r, 2500));
  }
})();
