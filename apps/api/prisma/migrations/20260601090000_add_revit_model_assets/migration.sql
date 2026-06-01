CREATE TABLE "revit_model_assets" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "revit_model_id" UUID,
  "view_name" TEXT NOT NULL,
  "source_view_id" TEXT,
  "export_format" TEXT NOT NULL DEFAULT 'OBJ',
  "asset_object_key" TEXT NOT NULL,
  "asset_mime_type" TEXT NOT NULL,
  "file_size" BIGINT,
  "checksum_sha256" TEXT,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "revit_model_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_revit_model_assets_project_synced"
  ON "revit_model_assets" ("project_id", "synced_at" DESC);

ALTER TABLE "revit_model_assets"
  ADD CONSTRAINT "revit_model_assets_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revit_model_assets"
  ADD CONSTRAINT "revit_model_assets_revit_model_id_fkey"
  FOREIGN KEY ("revit_model_id") REFERENCES "revit_models"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
