import { validateMapping } from "./mapping-validation";
import { AppException } from "../../common/errors";

describe("validateMapping", () => {
  it("accepts a mapping with identity.name and no duplicates", () => {
    expect(() => validateMapping({ Company: "identity.name", Revenue: "firmographics.revenueUsd" })).not.toThrow();
  });

  it("rejects a mapping missing identity.name", () => {
    expect(() => validateMapping({ Revenue: "firmographics.revenueUsd" })).toThrow(AppException);
    try {
      validateMapping({ Revenue: "firmographics.revenueUsd" });
    } catch (e) {
      expect((e as AppException).code).toBe("MAPPING_INVALID");
      expect((e as AppException).getStatus()).toBe(422);
    }
  });

  it("rejects two columns mapped to the same target field", () => {
    expect(() => validateMapping({ Name1: "identity.name", Name2: "identity.name" })).toThrow(AppException);
  });

  it("allows unmapped (null) columns without affecting validity", () => {
    expect(() => validateMapping({ Company: "identity.name", "Some Column": null })).not.toThrow();
  });

  it("rejects an unknown canonical field target", () => {
    expect(() => validateMapping({ Company: "identity.name", X: "not.a.real.field" as never })).toThrow(AppException);
  });
});
