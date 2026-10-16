import { toGeminiJsonSchema } from "./gemini-ai.provider";

describe("toGeminiJsonSchema", () => {
  it("renames definitions to $defs and rewrites $ref paths to match", () => {
    const input = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { criteria: { type: "array", items: { $ref: "#/definitions/Criterion" } } },
      definitions: { Criterion: { type: "object", properties: { id: { type: "string" } } } },
    };

    const out = toGeminiJsonSchema(input);

    expect(out.$schema).toBeUndefined();
    expect(out.definitions).toBeUndefined();
    expect(out.$defs).toEqual({ Criterion: { type: "object", properties: { id: { type: "string" } } } });
    expect((out.properties as { criteria: { items: { $ref: string } } }).criteria.items.$ref).toBe("#/$defs/Criterion");
  });

  it("passes schemas with no definitions through unchanged apart from dropping $schema", () => {
    const input = { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { name: { type: "string" } }, required: ["name"] };

    const out = toGeminiJsonSchema(input);

    expect(out).toEqual({ type: "object", properties: { name: { type: "string" } }, required: ["name"] });
  });
});
