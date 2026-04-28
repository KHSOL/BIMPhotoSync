-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('WORKER', 'MANAGER', 'PROJECT_ADMIN', 'BIM_MANAGER', 'COMPANY_ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('WORKER', 'MANAGER', 'PROJECT_ADMIN', 'BIM_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "WorkSurface" AS ENUM ('FLOOR', 'WALL', 'CEILING', 'WINDOW', 'DOOR', 'PIPE', 'ELECTRIC', 'OTHER');

-- CreateEnum
CREATE TYPE "Trade" AS ENUM ('WATERPROOF', 'TILE', 'PAINT', 'ELECTRIC', 'MEP', 'WINDOW', 'CONCRETE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "RowStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'HEURISTIC');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'WORKER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "access_key_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ProjectMemberRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revit_models" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "model_name" TEXT NOT NULL,
    "document_guid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revit_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "levels" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "elevation" DOUBLE PRECISION,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "revit_model_id" UUID,
    "level_id" UUID,
    "bim_photo_room_id" TEXT NOT NULL,
    "revit_unique_id" TEXT,
    "revit_element_id" TEXT,
    "room_number" TEXT,
    "room_name" TEXT NOT NULL,
    "level_name" TEXT,
    "area_m2" DECIMAL(12,2),
    "location_text" TEXT,
    "status" "RowStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_uploads" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "checksum_sha256" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "work_surface" "WorkSurface" NOT NULL,
    "trade" "Trade" NOT NULL,
    "work_date" DATE NOT NULL,
    "worker_name" TEXT,
    "description" TEXT,
    "ai_description" TEXT,
    "progress_status" "ProgressStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "storage_provider" TEXT NOT NULL DEFAULT 'S3',
    "object_key" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "checksum_sha256" TEXT,
    "taken_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RowStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_ai_analyses" (
    "id" UUID NOT NULL,
    "photo_id" UUID NOT NULL,
    "model_provider" "AiProvider" NOT NULL,
    "model_name" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "result_json" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "detected_trade" "Trade",
    "detected_surface" "WorkSurface",
    "progress_status" "ProgressStatus" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "requires_human_review" BOOLEAN NOT NULL DEFAULT true,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_company_id_code_key" ON "projects"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "levels_project_id_name_key" ON "levels"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_bim_photo_room_id_key" ON "rooms"("bim_photo_room_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_revit_unique_id_key" ON "rooms"("revit_unique_id");

-- CreateIndex
CREATE INDEX "idx_rooms_project_level_name" ON "rooms"("project_id", "level_name", "room_name");

-- CreateIndex
CREATE INDEX "idx_photos_project_room_workdate_desc" ON "photos"("project_id", "room_id", "work_date" DESC, "uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "idx_photos_project_trade_surface_date" ON "photos"("project_id", "trade", "work_surface", "work_date" DESC);

-- CreateIndex
CREATE INDEX "idx_photos_uploaded_by_date" ON "photos"("uploaded_by", "uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "idx_photo_ai_review_queue" ON "photo_ai_analyses"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revit_models" ADD CONSTRAINT "revit_models_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levels" ADD CONSTRAINT "levels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_revit_model_id_fkey" FOREIGN KEY ("revit_model_id") REFERENCES "revit_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_uploads" ADD CONSTRAINT "photo_uploads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_ai_analyses" ADD CONSTRAINT "photo_ai_analyses_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_ai_analyses" ADD CONSTRAINT "photo_ai_analyses_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
