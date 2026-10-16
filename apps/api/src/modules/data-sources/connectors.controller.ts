import { Controller, Get, UseGuards } from "@nestjs/common";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { DataSourcesService } from "./data-sources.service";

@Controller("connectors")
@UseGuards(WorkspaceGuard)
export class ConnectorsController {
  constructor(private readonly dataSources: DataSourcesService) {}

  @Get()
  list() {
    return this.dataSources.connectorCatalogue();
  }
}
