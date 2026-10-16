import { Module } from "@nestjs/common";
import { NormalizersService } from "./normalizers";
import { CompanyMatcherService } from "./company-matcher.service";
import { AttributeWriterService } from "./attribute-writer.service";
import { PersonWriterService } from "./person-writer.service";
import { ResolverService } from "./resolver.service";
import { IngestionService } from "./ingestion.service";

@Module({
  providers: [NormalizersService, CompanyMatcherService, AttributeWriterService, PersonWriterService, ResolverService, IngestionService],
  exports: [NormalizersService, CompanyMatcherService, AttributeWriterService, PersonWriterService, ResolverService, IngestionService],
})
export class NormalizationModule {}
