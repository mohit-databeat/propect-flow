import { HttpStatus, Injectable, PipeTransform } from "@nestjs/common";
import { ErrorCodes } from "@prospect/shared";
import type { ZodTypeAny, z } from "zod";
import { AppException } from "./errors";

@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {

    const result = this.schema.safeParse(value === undefined ? {} : value);
    if (!result.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.VALIDATION_ERROR,
        "Validation failed",
        result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    return result.data;
  }
}
