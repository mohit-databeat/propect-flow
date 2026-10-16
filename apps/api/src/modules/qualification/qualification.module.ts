import { Module } from "@nestjs/common";
import { NormalizationModule } from "../normalization/normalization.module";
import { AiModule } from "../ai/ai.module";
import { QualificationService } from "./qualification.service";
import { QualitativeAssessorService } from "./qualitative-assessor.service";

@Module({
  imports: [NormalizationModule, AiModule],
  providers: [QualificationService, QualitativeAssessorService],
  exports: [QualificationService, QualitativeAssessorService],
})
export class QualificationModule {}
