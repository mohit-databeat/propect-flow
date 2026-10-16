import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { EnrichmentModule } from "../enrichment/enrichment.module";
import { QualificationModule } from "../qualification/qualification.module";
import { MessagesModule } from "../messages/messages.module";
import { ProspectsController } from "./prospects.controller";
import { ProspectsService } from "./prospects.service";

@Module({
  imports: [ProjectsModule, EnrichmentModule, QualificationModule, MessagesModule],
  controllers: [ProspectsController],
  providers: [ProspectsService],
  exports: [ProspectsService],
})
export class ProspectsModule {}
