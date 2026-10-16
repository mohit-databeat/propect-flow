import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ProjectsModule } from "../projects/projects.module";
import { AiModule } from "../ai/ai.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { NormalizationModule } from "../normalization/normalization.module";
import { DataSourcesController } from "./data-sources.controller";
import { ConnectorsController } from "./connectors.controller";
import { DataSourcesService } from "./data-sources.service";

@Module({

  imports: [ProjectsModule, AiModule, ConnectorsModule, NormalizationModule, MulterModule.register({ storage: memoryStorage() })],
  controllers: [DataSourcesController, ConnectorsController],
  providers: [DataSourcesService],
  exports: [DataSourcesService],
})
export class DataSourcesModule {}
