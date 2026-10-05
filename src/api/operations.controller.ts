import { Controller, Get, UseFilters } from "@nestjs/common";
import { config } from "../config";
import { checkDatabase, readMetrics } from "../persistence/metrics.repository";
import { Errors } from "./error-filter";

@Controller("api")
@UseFilters(Errors)
export class OperationsController {
  @Get("health") async health() {
    await checkDatabase();
    return {
      status: "ok",
      environment: config.environment,
      region: config.region,
      llmEnabled: config.llm,
    };
  }
  @Get("metrics") metrics() {
    return readMetrics();
  }
}
