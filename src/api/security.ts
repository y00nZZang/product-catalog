import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";

/** Token and same-origin checks apply to every API controller, including future routes. */

export const apiSecurity = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'",
  );
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.headers.host}`
    )
      return res.status(403).json({ error: "origin_not_allowed" });
    if (!config.publicAccess && config.accessToken) {
      const actual = Buffer.from(
          String(req.headers.authorization || "").replace(/^Bearer /, ""),
        ),
        expected = Buffer.from(config.accessToken);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return res.status(401).json({ error: "unauthorized" });
    }
  }
  next();
};
