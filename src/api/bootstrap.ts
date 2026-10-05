import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { config } from "../config";
import { AppModule } from "./app.module";
import { apiSecurity } from "./security";

export async function start() {
  if (
    !["127.0.0.1", "localhost", "::1"].includes(config.host) &&
    !config.publicAccess &&
    config.accessToken.length < 24
  )
    throw new Error(
      "Remote binding requires a 24+ character CATALOG_ACCESS_TOKEN",
    );
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    bodyParser: true,
  });
  // Enable only when the API is unreachable except through the single trusted proxy.
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(apiSecurity);
  app.useStaticAssets(join(process.cwd(), "public"));
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  console.log(`Catalog: http://${config.host}:${config.port}`);
  return app;
}
