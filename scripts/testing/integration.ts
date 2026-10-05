import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { config } from "../../src/config";
(async () => {
  const admin = new Pool({ connectionString: config.databaseUrl });
  const name = "catalog_test_" + randomBytes(6).toString("hex");
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(config.databaseUrl);
  url.pathname = "/" + name;
  try {
    const env = {
      ...process.env,
      DATABASE_URL: url.href,
      LLM_ENABLED: "false",
      AUTO_CUSTOMS_ENABLED: "false",
      CUSTOMS_API_KEY: "",
      RAKUTEN_APPLICATION_ID: "",
      RAKUTEN_ACCESS_KEY: "",
      BROWSER_ENABLED: "false",
      PORT: "0",
      HOST: "127.0.0.1",
      CATALOG_ACCESS_TOKEN: "integration-only-access-token-123",
      EXECUTION_ENV: "synthetic_test",
      EXECUTION_REGION: "local",
    };
    for (const args of [
      ["--import", "tsx", "scripts/database/migrate.ts"],
      [
        "--import",
        "tsx",
        "--test",
        "--test-concurrency=1",
        ...readdirSync("test/integration")
          .filter((n) => n.endsWith(".test.ts"))
          .map((n) => "test/integration/" + n),
      ],
    ]) {
      const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
      if (r.status !== 0) {
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
})().catch(() => {
  console.error("Integration database setup failed");
  process.exitCode = 1;
});
