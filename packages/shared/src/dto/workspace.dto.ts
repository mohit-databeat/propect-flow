import { z } from "zod";

export const SourcePrecedence = z.array(z.enum(["MANUAL", "ENRICHMENT", "SOURCE", "NORMALIZER", "AI"])).min(1);

export const WorkspaceSettings = z.object({
  aiProviderKey: z.string().default("mock"),
  enrichmentProviderKey: z.string().default("mock_enrichment"),
  outboundProviderKey: z.string().default("simulated"),
  sourcePrecedence: SourcePrecedence.default(["MANUAL", "ENRICHMENT", "SOURCE", "NORMALIZER", "AI"]),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

export const UpdateWorkspaceDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    settings: WorkspaceSettings.partial().optional(),
  })
  .refine((v) => v.name !== undefined || v.settings !== undefined, "nothing to update");
export type UpdateWorkspaceDto = z.infer<typeof UpdateWorkspaceDto>;

export interface WorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  settings: WorkspaceSettings;
  role: "OWNER" | "ADMIN" | "MEMBER";
  createdAt: string;
}

export interface WorkspaceMemberResponse {
  userId: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
}
