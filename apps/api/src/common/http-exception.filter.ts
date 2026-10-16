import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { ErrorCodes, type ApiErrorBody } from "@prospect/shared";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let body: ApiErrorBody;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === "object" && payload !== null && "code" in payload) {
        const p = payload as Partial<ApiErrorBody>;
        body = { statusCode: status, code: p.code ?? defaultCode(status), message: p.message ?? exception.message, details: p.details };
      } else {
        const message =
          typeof payload === "string"
            ? payload
            : ((payload as { message?: string | string[] }).message ?? exception.message);
        body = { statusCode: status, code: defaultCode(status), message: Array.isArray(message) ? message.join("; ") : message };
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
      body = { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: ErrorCodes.INTERNAL_ERROR, message: "Internal server error" };
    }

    if (body.details === undefined) delete body.details;
    res.status(body.statusCode).json(body);
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.VALIDATION_ERROR;
    case 401:
      return ErrorCodes.UNAUTHORIZED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    default:
      return status >= 500 ? ErrorCodes.INTERNAL_ERROR : `HTTP_${status}`;
  }
}
