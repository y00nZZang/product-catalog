import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("env files are optional and preserve process > local > shared precedence", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "catalog-env-test-"));
  const loader = resolve("src/config/environment.ts");
  const keys = [
    "CATALOG_TEST_EXISTING",
    "CATALOG_TEST_LOCAL",
    "CATALOG_TEST_SHARED",
  ];
  const env = { ...process.env };
  for (const key of keys) delete env[key];
  env.CATALOG_TEST_EXISTING = "shell";
  const run = () =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `require(${JSON.stringify(loader)}).loadEnvironment(${JSON.stringify(directory)}); console.log(JSON.stringify(${JSON.stringify(keys)}.map(k => process.env[k] ?? null)))`,
        ],
        { env, encoding: "utf8" },
      ),
    );
  try {
    assert.deepEqual(run(), ["shell", null, null]);
    writeFileSync(
      resolve(directory, ".env"),
      "CATALOG_TEST_EXISTING=shared\nCATALOG_TEST_LOCAL=shared\nCATALOG_TEST_SHARED=shared\n",
    );
    assert.deepEqual(run(), ["shell", "shared", "shared"]);
    writeFileSync(
      resolve(directory, ".env.local"),
      "CATALOG_TEST_EXISTING=local\nCATALOG_TEST_LOCAL=local\n",
    );
    assert.deepEqual(run(), ["shell", "local", "shared"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
