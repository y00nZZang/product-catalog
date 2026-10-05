import { getCustomsFx } from "../customs/fx";
import { taxAnalysisRequest } from "../customs/schema";
import { createTaxQuote } from "../customs/service";
import { requestTaxRun, getCustoms } from "../persistence/customs.repository";
import { taxMetadata } from "../customs/profiles";
import { Body, Controller, Get, Param, Post, UseFilters } from "@nestjs/common";
import { getListing, listListings } from "../persistence/catalog.repository";
import { calculateQuote } from "../shipping/quote-service";
import { requestPackageAnalysis } from "../packaging/service";
import { uuid, packageAnalysisRequest } from "./validation";
import { Errors } from "./error-filter";
import { HttpCode } from "@nestjs/common";

@Controller("api/listings")
@UseFilters(Errors)
export class CatalogController {
  @Get() list() {
    return listListings();
  }
  @Get("tax-fx") taxFx() {
    return getCustomsFx();
  }
  @Get("tax-metadata") taxMetadata() {
    return taxMetadata();
  }
  @Get(":id/customs") customs(@Param("id") id: string) {
    return getCustoms(uuid(id));
  }
  @Post(":id/tax-analysis") @HttpCode(202) taxAnalysis(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const b = taxAnalysisRequest.parse(body);
    return requestTaxRun(uuid(id), b.hint.trim(), b.automatic);
  }
  @Post(":id/tax-quotes") taxQuote(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return createTaxQuote(uuid(id), body);
  }
  @Get(":id") listing(@Param("id") id: string) {
    return getListing(uuid(id));
  }
  @Post(":id/quotes") quote(@Param("id") id: string, @Body() body: unknown) {
    return calculateQuote(uuid(id), body);
  }
  @Post(":id/package-analysis") @HttpCode(202) packageAnalysis(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const b = packageAnalysisRequest.parse(body);
    return requestPackageAnalysis(uuid(id), b.hint.trim());
  }
}
