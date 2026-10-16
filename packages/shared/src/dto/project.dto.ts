import { z } from "zod";

export const ProjectStatus = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const CreateProjectDto = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type CreateProjectDto = z.infer<typeof CreateProjectDto>;

export const UpdateProjectDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: ProjectStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "nothing to update");
export type UpdateProjectDto = z.infer<typeof UpdateProjectDto>;

export interface ProjectCounts {
  dataSources: number;
  companies: number;
  prospects: number;
  qualified: number;
  needsReview: number;
  disqualified: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  counts: ProjectCounts;
  activeIcp: { id: string; name: string; version: number } | null;
  lastRun: { id: string; status: string; startedAt: string | null; finishedAt: string | null } | null;
}
