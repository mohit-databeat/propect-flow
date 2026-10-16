-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IcpStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DataSourceType" AS ENUM ('CSV', 'API');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('DRAFT', 'READY', 'SYNCING', 'SYNCED', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttributeSourceType" AS ENUM ('SOURCE', 'ENRICHMENT', 'MANUAL', 'NORMALIZER', 'AI');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('PENDING', 'QUALIFIED', 'DISQUALIFIED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "CriterionStatus" AS ENUM ('PASS', 'FAIL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Evaluator" AS ENUM ('DETERMINISTIC', 'LLM');

-- CreateEnum
CREATE TYPE "QualificationPhase" AS ENUM ('INITIAL', 'POST_ENRICHMENT');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('FIELD_VALUE', 'TEXT_SNIPPET', 'URL', 'JOB_POSTING', 'NEWS_ITEM');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AiPurpose" AS ENUM ('ICP_EXTRACTION', 'CSV_MAPPING_SUGGEST', 'QUALITATIVE_ASSESS', 'EMAIL_GENERATE', 'EMAIL_QA');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCEEDED', 'SCHEMA_RETRY', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('PENDING', 'RUNNING', 'AWAITING_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowStepKey" AS ENUM ('INGEST', 'NORMALIZE', 'QUALIFY', 'ENRICH', 'REQUALIFY', 'GENERATE_EMAIL', 'QA', 'AWAIT_REVIEW');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "QaStatus" AS ENUM ('PENDING', 'PASS', 'WARN', 'FAIL');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('NOT_SENT', 'QUEUED', 'SENT_SIMULATED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icp_profiles" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "IcpStatus" NOT NULL DEFAULT 'DRAFT',
    "naturalLanguage" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "chatTranscript" JSONB NOT NULL DEFAULT '[]',
    "blockingOpenCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icp_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "DataSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "lastSyncedAt" TIMESTAMP(3),
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedCompanyId" TEXT,
    "normalizationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "website" TEXT,
    "linkedinUrl" TEXT,
    "industry" TEXT,
    "industryRaw" TEXT,
    "subIndustry" TEXT,
    "description" TEXT,
    "country" TEXT,
    "hqCity" TEXT,
    "hqState" TEXT,
    "employeeCount" INTEGER,
    "employeeRange" TEXT,
    "revenueUsd" BIGINT,
    "revenueRange" TEXT,
    "foundedYear" INTEGER,
    "fundingStage" TEXT,
    "totalFundingUsd" BIGINT,
    "lastFundingDate" TIMESTAMP(3),
    "techStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canonical" JSONB NOT NULL DEFAULT '{}',
    "canonicalSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "resolvedHash" TEXT,
    "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "normalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_attributes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceType" "AttributeSourceType" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "enrichmentRunId" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "seniority" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "providerKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospects" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "icpProfileId" TEXT NOT NULL,
    "status" "ProspectStatus" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER,
    "coverage" INTEGER,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "aiReasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualification_results" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "criterionLabel" TEXT NOT NULL,
    "phase" "QualificationPhase" NOT NULL,
    "status" "CriterionStatus" NOT NULL,
    "weight" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL,
    "evaluator" "Evaluator" NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" INTEGER,
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qualification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "qualificationResultId" TEXT NOT NULL,
    "companyAttributeId" TEXT,
    "kind" "EvidenceKind" NOT NULL,
    "content" JSONB NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrichment_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "providerKey" TEXT NOT NULL,
    "requestedFields" TEXT[],
    "suppliedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unavailableFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "costUnits" INTEGER NOT NULL DEFAULT 0,
    "rawResponse" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrichment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "purpose" "AiPurpose" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "rawOutput" TEXT,
    "status" "AiRunStatus" NOT NULL,
    "error" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "icpProfileId" TEXT NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'PENDING',
    "triggeredById" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "currentStep" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stepKey" "WorkflowStepKey" NOT NULL,
    "order" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'QUEUED',
    "inputHash" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "outboundProviderKey" TEXT NOT NULL DEFAULT 'simulated',
    "senderConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "campaignId" TEXT,
    "prospectId" TEXT,
    "companyId" TEXT NOT NULL,
    "personId" TEXT,
    "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL',
    "toAddress" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "generatedSubject" TEXT NOT NULL,
    "generatedBody" TEXT NOT NULL,
    "generationAiRunId" TEXT,
    "qaAiRunId" TEXT,
    "qaStatus" "QaStatus" NOT NULL DEFAULT 'PENDING',
    "qaResult" JSONB,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "sendStatus" "SendStatus" NOT NULL DEFAULT 'NOT_SENT',
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "sendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "projects_workspaceId_idx" ON "projects"("workspaceId");

-- CreateIndex
CREATE INDEX "icp_profiles_projectId_status_idx" ON "icp_profiles"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "icp_profiles_projectId_version_key" ON "icp_profiles"("projectId", "version");

-- CreateIndex
CREATE INDEX "data_sources_projectId_idx" ON "data_sources"("projectId");

-- CreateIndex
CREATE INDEX "source_records_dataSourceId_idx" ON "source_records"("dataSourceId");

-- CreateIndex
CREATE INDEX "source_records_normalizedCompanyId_idx" ON "source_records"("normalizedCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_dataSourceId_payloadHash_key" ON "source_records"("dataSourceId", "payloadHash");

-- CreateIndex
CREATE INDEX "companies_workspaceId_idx" ON "companies"("workspaceId");

-- CreateIndex
CREATE INDEX "companies_projectId_name_idx" ON "companies"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_projectId_domain_key" ON "companies"("projectId", "domain");

-- CreateIndex
CREATE INDEX "company_attributes_companyId_field_observedAt_idx" ON "company_attributes"("companyId", "field", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "company_attributes_companyId_providerKey_observedAt_idx" ON "company_attributes"("companyId", "providerKey", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "company_attributes_enrichmentRunId_idx" ON "company_attributes"("enrichmentRunId");

-- CreateIndex
CREATE INDEX "people_companyId_idx" ON "people"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "people_companyId_dedupeKey_key" ON "people"("companyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "prospects_projectId_status_idx" ON "prospects"("projectId", "status");

-- CreateIndex
CREATE INDEX "prospects_projectId_score_idx" ON "prospects"("projectId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "prospects_workflowRunId_companyId_key" ON "prospects"("workflowRunId", "companyId");

-- CreateIndex
CREATE INDEX "qualification_results_prospectId_idx" ON "qualification_results"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "qualification_results_prospectId_criterionId_phase_key" ON "qualification_results"("prospectId", "criterionId", "phase");

-- CreateIndex
CREATE INDEX "evidence_qualificationResultId_idx" ON "evidence"("qualificationResultId");

-- CreateIndex
CREATE INDEX "enrichment_runs_companyId_idx" ON "enrichment_runs"("companyId");

-- CreateIndex
CREATE INDEX "enrichment_runs_workflowRunId_idx" ON "enrichment_runs"("workflowRunId");

-- CreateIndex
CREATE INDEX "ai_runs_workspaceId_purpose_createdAt_idx" ON "ai_runs"("workspaceId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_refType_refId_idx" ON "ai_runs"("refType", "refId");

-- CreateIndex
CREATE INDEX "workflow_runs_projectId_createdAt_idx" ON "workflow_runs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_steps_workflowRunId_order_idx" ON "workflow_steps"("workflowRunId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflowRunId_stepKey_attempt_key" ON "workflow_steps"("workflowRunId", "stepKey", "attempt");

-- CreateIndex
CREATE INDEX "campaigns_projectId_idx" ON "campaigns"("projectId");

-- CreateIndex
CREATE INDEX "messages_projectId_reviewStatus_idx" ON "messages"("projectId", "reviewStatus");

-- CreateIndex
CREATE INDEX "messages_campaignId_sendStatus_idx" ON "messages"("campaignId", "sendStatus");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icp_profiles" ADD CONSTRAINT "icp_profiles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icp_profiles" ADD CONSTRAINT "icp_profiles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_normalizedCompanyId_fkey" FOREIGN KEY ("normalizedCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_attributes" ADD CONSTRAINT "company_attributes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_attributes" ADD CONSTRAINT "company_attributes_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "source_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_attributes" ADD CONSTRAINT "company_attributes_enrichmentRunId_fkey" FOREIGN KEY ("enrichmentRunId") REFERENCES "enrichment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "icp_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_results" ADD CONSTRAINT "qualification_results_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_results" ADD CONSTRAINT "qualification_results_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_qualificationResultId_fkey" FOREIGN KEY ("qualificationResultId") REFERENCES "qualification_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_companyAttributeId_fkey" FOREIGN KEY ("companyAttributeId") REFERENCES "company_attributes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "icp_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_generationAiRunId_fkey" FOREIGN KEY ("generationAiRunId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_qaAiRunId_fkey" FOREIGN KEY ("qaAiRunId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
