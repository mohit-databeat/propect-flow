-- AlterTable
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_name_key" UNIQUE ("workspaceId", "name");
