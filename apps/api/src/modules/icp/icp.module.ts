import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { AiModule } from "../ai/ai.module";
import { IcpController } from "./icp.controller";
import { IcpService } from "./icp.service";

@Module({
  imports: [ProjectsModule, AiModule],
  controllers: [IcpController],
  providers: [IcpService],
  exports: [IcpService],
})
export class IcpModule {}
