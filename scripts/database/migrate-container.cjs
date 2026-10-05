const { Pool } = require("pg");
const fs = require("node:fs");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(431001)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    for (const name of fs
      .readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        !(
          await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name])
        ).rowCount
      ) {
        await c.query(fs.readFileSync("migrations/" + name, "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        console.log("Applied", name);
      }
    }
    await c.query("COMMIT");
  } catch {
    await c.query("ROLLBACK");
    process.exitCode = 1;
    console.error("Migration failed");
  } finally {
    c.release();
    await p.end();
  }
})();
