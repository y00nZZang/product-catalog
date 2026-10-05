import { z } from "zod";

export class CatalogError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public retryAfterMs = 0,
  ) {
    super(code);
  }
}

/** Only stable error codes cross the HTTP/log boundary; provider errors can contain secrets. */

export function errorCode(e: unknown) {
  return e instanceof CatalogError
    ? e.code
    : e instanceof z.ZodError
      ? "invalid_input"
      : "internal_error";
}
