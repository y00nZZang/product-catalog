import { loadEnvironment } from "./environment";

loadEnvironment();

export const config = {
  publicAccess: process.env.CATALOG_PUBLIC_ACCESS === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  autoCustoms: process.env.AUTO_CUSTOMS_ENABLED !== "false",
  databaseUrl:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.USER || "catalog"}@127.0.0.1:55432/catalog`,
  port: Number(process.env.PORT || 4310),
  host: process.env.HOST || "127.0.0.1",
  environment: process.env.EXECUTION_ENV || "local",
  region: process.env.EXECUTION_REGION || "local",
  accessToken: process.env.CATALOG_ACCESS_TOKEN || "",
  browser: process.env.BROWSER_ENABLED !== "false",
  llm: process.env.LLM_ENABLED === "true",
  model: process.env.OPENAI_MODEL || "gpt-6-luna",
  budgetUnlimited: process.env.OPENAI_BUDGET_UNLIMITED === "true",
  dailyBudget: Number(process.env.OPENAI_DAILY_BUDGET_USD || 0),
  callReserve: Number(process.env.OPENAI_CALL_RESERVE_USD || 0.1),
  leaseSeconds: 180,
  requestTimeoutMs: 20000,
  siteIntervalMs: 2500,
  maxAttempts: 3,
};
