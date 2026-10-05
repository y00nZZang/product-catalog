const { rmSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

// Renamed source modules must not leave runnable copies behind in dist/.
rmSync(resolve("dist"), { recursive: true, force: true });
const result = spawnSync(resolve("node_modules/.bin/tsc"), [], {
  stdio: "inherit",
});
if (result.error)
  console.error("Unable to start the local TypeScript compiler");
process.exitCode = result.status ?? 1;
