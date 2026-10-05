import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  HttpCode,
  UseFilters,
} from "@nestjs/common";
import { submit, getRun } from "../persistence/catalog.repository";
import { uuid, analysisRequest } from "./validation";
import { Errors } from "./error-filter";

@Controller("api/analyses")
@UseFilters(Errors)
export class AnalysisController {
  @Post() @HttpCode(202) submit(@Body() body: unknown) {
    const b = analysisRequest.parse(body);
    return submit(b.url, b.refresh);
  }
  @Get(":id") run(@Param("id") id: string) {
    return getRun(uuid(id));
  }
}
