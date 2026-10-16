import { z } from "zod";

export const RegisterDto = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
});
export type RegisterDto = z.infer<typeof RegisterDto>;

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const RefreshDto = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshDto = z.infer<typeof RefreshDto>;

export const UpdateProfileDto = z.object({
  name: z.string().min(1).max(120),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;

export const ChangePasswordDto = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordDto>;

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface WorkspaceMembershipSummary {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserSummary;
}

export interface MeResponse {
  user: UserSummary;
  memberships: WorkspaceMembershipSummary[];
}
