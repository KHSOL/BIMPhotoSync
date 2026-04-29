CREATE TYPE "ReportStatus" AS ENUM ('GENERATED', 'FAILED');

CREATE TYPE "ReportFormat" AS ENUM ('JSON', 'PDF', 'DOCX', 'HWP');

CREATE TABLE "generated_reports" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL DEFAULT 'JSON',
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATED',
    "filters" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "summary" TEXT,
    "photo_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "model_provider" TEXT NOT NULL DEFAULT 'HEURISTIC',
    "model_name" TEXT NOT NULL DEFAULT 'bim-photo-sync-report-v1',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_generated_reports_project_created" ON "generated_reports"("project_id", "created_at" DESC);

CREATE INDEX "idx_generated_reports_creator_created" ON "generated_reports"("created_by", "created_at" DESC);

ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
