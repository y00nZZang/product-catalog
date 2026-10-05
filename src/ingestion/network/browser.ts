import { CatalogError, type Identity } from "../../domain";
import { safeGet } from "./http";
import { checkChallenge } from "./policy";

export async function browserGet(identity: Identity) {
  // Route every request through validated, pinned HTTP. No user profile/cookies or private network access.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  let navigationError: unknown;
  try {
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (
        !["document", "script", "xhr", "fetch", "stylesheet"].includes(
          req.resourceType(),
        ) ||
        req.method() !== "GET"
      )
        return route.abort();
      try {
        const u = new URL(req.url());
        const allowed =
          u.hostname === "jp.mercari.com" ||
          u.hostname.endsWith(".mercari.jp") ||
          u.hostname.endsWith(".mercari.com") ||
          u.hostname.endsWith(".mercdn.net") ||
          u.hostname.endsWith(".rakuten.co.jp") ||
          u.hostname.endsWith(".rakuten-static.com");
        if (!allowed) return route.abort();
        const headers = await req.allHeaders();
        for (const key of [
          "host",
          "cookie",
          "content-length",
          "accept-encoding",
          "connection",
        ])
          delete headers[key];
        const result = await safeGet(
          u.href,
          new Set([u.hostname]),
          headers,
          req.isNavigationRequest() ? identity : undefined,
        );
        await route.fulfill({
          status: 200,
          body: result.html,
          contentType: result.contentType,
          headers: {
            "access-control-allow-origin": new URL(identity.canonicalUrl)
              .origin,
          },
        });
      } catch (e) {
        if (req.isNavigationRequest()) navigationError = e;
        await route.abort();
      }
    });
    const page = await context.newPage();
    try {
      await page.goto(identity.canonicalUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch {
      throw navigationError || new CatalogError("browser_navigation_failed");
    }
    await page
      .waitForFunction(
        () =>
          document.querySelector("h1") ||
          document.querySelector('script[type="application/ld+json"]'),
        {},
        { timeout: 8000 },
      )
      .catch(() => {});
    const html = await page.content();
    checkChallenge(html);
    return { html, url: page.url(), status: 200 };
  } finally {
    await context.close();
    await browser.close();
  }
}
