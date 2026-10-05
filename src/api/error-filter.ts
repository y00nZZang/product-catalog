import {
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from "@nestjs/common";
import { errorCode } from "../domain";

@Catch()
export class Errors implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const code = errorCode(e);
    host
      .switchToHttp()
      .getResponse()
      .status(
        code === "not_found" ? 404 : code === "internal_error" ? 500 : 400,
      )
      .json({ error: code });
  }
}
