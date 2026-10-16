import { Controller, Get, UseGuards } from "@nestjs/common";
import type { SettingsResponse } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { SettingsService } from "./settings.service";

@Controller("settings")
@UseGuards(WorkspaceGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@CurrentWorkspace() ws: WorkspaceContext): Promise<SettingsResponse> {
    return this.settings.get(ws);
  }
}
