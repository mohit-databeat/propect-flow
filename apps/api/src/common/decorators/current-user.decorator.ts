import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface AuthUser {
  userId: string;
  email: string;
}

export interface WorkspaceContext {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  workspace: WorkspaceContext;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
});

export const CurrentWorkspace = createParamDecorator((_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().workspace;
});
