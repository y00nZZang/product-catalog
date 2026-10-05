import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

// src/config and dist/config both resolve env files from the project root.
// loadEnvFile preserves variables already present in process.env.
export function loadEnvironment(directory = resolve(__dirname, "../..")) {
  for (const name of [".env.local", ".env"]) {
    try {
      loadEnvFile(resolve(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Do not include file contents or secret values in startup errors.
        throw new Error(`Cannot load ${name}`);
      }
    }
  }
}
