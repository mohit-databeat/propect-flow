import { HttpStatus } from "@nestjs/common";
import { CanonicalFieldPath, ErrorCodes, type FieldMappingDto } from "@prospect/shared";
import { AppException } from "../../common/errors";

const VALID_TARGETS = new Set<string>(CanonicalFieldPath.options);

export function validateMapping(mapping: FieldMappingDto): void {
  const targets: string[] = Object.values(mapping).filter((v): v is NonNullable<typeof v> => v !== null && v !== undefined);

  for (const t of targets) {
    if (!VALID_TARGETS.has(t)) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCodes.MAPPING_INVALID, `Unknown canonical field "${t}"`);
    }
  }
  if (!targets.includes("identity.name")) {
    throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCodes.MAPPING_INVALID, "identity.name must be mapped to a column");
  }
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t)) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCodes.MAPPING_INVALID, `Field "${t}" is mapped from more than one column`);
    }
    seen.add(t);
  }
}
