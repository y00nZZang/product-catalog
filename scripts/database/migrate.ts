import { readFileSync, readdirSync } from "node:fs";
import { pool, tx } from "../../src/persistence/connection";
(async () => {
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(431001)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    for (const name of readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        !(
          await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name])
        ).rowCount
      ) {
        await c.query(readFileSync(`migrations/${name}`, "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        console.log("Applied", name);
      }
    }
  });
  await pool.end();
})().catch(() => {
  console.error("Migration failed");
  process.exitCode = 1;
  pool.end();
});
