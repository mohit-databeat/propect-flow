import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ErrorCodes } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedRequest } from "../decorators/current-user.decorator";
import { forbidden } from "../errors";

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const headerWorkspaceId = req.headers["x-workspace-id"];
    const requestedId = Array.isArray(headerWorkspaceId) ? headerWorkspaceId[0] : headerWorkspaceId;

    const membership = requestedId
      ? await this.prisma.workspaceMember.findFirst({ where: { userId: req.user.userId, workspaceId: requestedId } })
      : await this.prisma.workspaceMember.findFirst({ where: { userId: req.user.userId }, orderBy: { createdAt: "asc" } });

    if (!membership) {
      throw forbidden(ErrorCodes.NOT_A_WORKSPACE_MEMBER, requestedId ? `Not a member of workspace ${requestedId}` : "User has no workspace");
    }

    req.workspace = { id: membership.workspaceId, role: membership.role };
    return true;
  }
}
