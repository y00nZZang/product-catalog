import { start } from "./api/bootstrap";
export { start } from "./api/bootstrap";

// Keep the process entrypoint stable for npm scripts and container commands.
if (require.main === module)
  start().catch(() => {
    console.error("Server startup failed: check database and access settings");
    process.exitCode = 1;
  });
