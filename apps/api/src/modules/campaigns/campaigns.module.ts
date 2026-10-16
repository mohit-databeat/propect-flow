import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { OutboundModule } from "../outbound/outbound.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  imports: [ProjectsModule, OutboundModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
