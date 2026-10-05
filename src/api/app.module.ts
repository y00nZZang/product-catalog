import { Module } from "@nestjs/common";
import { AnalysisController } from "./analysis.controller";
import { CatalogController } from "./catalog.controller";
import { OperationsController } from "./operations.controller";

@Module({
  controllers: [AnalysisController, CatalogController, OperationsController],
})
export class AppModule {}
