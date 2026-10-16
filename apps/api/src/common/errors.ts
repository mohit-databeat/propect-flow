import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrorCodes, type ErrorCode } from "@prospect/shared";

export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ statusCode: status, code, message, details }, status);
  }
}

export const notFound = (what: string, details?: unknown, code: ErrorCode | string = ErrorCodes.NOT_FOUND) =>
  new AppException(HttpStatus.NOT_FOUND, code, `${what} not found`, details);
export const forbidden = (code: ErrorCode | string, message: string) => new AppException(HttpStatus.FORBIDDEN, code, message);
export const conflict = (code: ErrorCode | string, message: string, details?: unknown) => new AppException(HttpStatus.CONFLICT, code, message, details);
export const unauthorized = (code: ErrorCode | string = ErrorCodes.UNAUTHORIZED, message = "Unauthorized") => new AppException(HttpStatus.UNAUTHORIZED, code, message);
export const failedDependency = (code: ErrorCode | string, message: string, details?: unknown) =>
  new AppException(HttpStatus.FAILED_DEPENDENCY, code, message, details);
export const badRequest = (code: ErrorCode | string, message: string, details?: unknown) => new AppException(HttpStatus.BAD_REQUEST, code, message, details);
