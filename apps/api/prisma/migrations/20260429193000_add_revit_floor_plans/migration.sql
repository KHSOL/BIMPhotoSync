-- CreateTable
CREATE TABLE "revit_floor_plans" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "revit_model_id" UUID,
    "level_name" TEXT NOT NULL,
    "view_name" TEXT NOT NULL,
    "source_view_id" TEXT,
    "bounds" JSONB NOT NULL,
    "rooms" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revit_floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_revit_floor_plans_project_level_created" ON "revit_floor_plans"("project_id", "level_name", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "revit_floor_plans" ADD CONSTRAINT "revit_floor_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revit_floor_plans" ADD CONSTRAINT "revit_floor_plans_revit_model_id_fkey" FOREIGN KEY ("revit_model_id") REFERENCES "revit_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
