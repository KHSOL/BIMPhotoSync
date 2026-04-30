CREATE TABLE "revit_sheets" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "revit_model_id" UUID,
  "revit_unique_id" TEXT,
  "revit_element_id" TEXT,
  "sheet_number" TEXT NOT NULL,
  "sheet_name" TEXT NOT NULL,
  "width_mm" DECIMAL(12,3),
  "height_mm" DECIMAL(12,3),
  "asset_object_key" TEXT,
  "asset_mime_type" TEXT,
  "asset_width_px" INTEGER,
  "asset_height_px" INTEGER,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "revit_sheets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "revit_views" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "revit_model_id" UUID,
  "sheet_id" UUID NOT NULL,
  "source_view_id" TEXT NOT NULL,
  "viewport_element_id" TEXT,
  "view_name" TEXT NOT NULL,
  "view_type" TEXT NOT NULL,
  "scale" INTEGER,
  "viewport_box" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "revit_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "revit_room_overlays" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "sheet_id" UUID NOT NULL,
  "view_id" UUID,
  "room_id" UUID,
  "bim_photo_room_id" TEXT NOT NULL,
  "polygon" JSONB NOT NULL,
  "normalized_polygon" JSONB NOT NULL,
  "bbox" JSONB NOT NULL,
  "coordinate_version" TEXT NOT NULL DEFAULT 'sheet-pixel-v1',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "revit_room_overlays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_revit_sheets_project_number" ON "revit_sheets"("project_id", "sheet_number");
CREATE UNIQUE INDEX "uq_revit_sheets_project_unique_id" ON "revit_sheets"("project_id", "revit_unique_id");
CREATE INDEX "idx_revit_sheets_project_synced" ON "revit_sheets"("project_id", "synced_at" DESC);

CREATE UNIQUE INDEX "uq_revit_views_sheet_view_viewport" ON "revit_views"("sheet_id", "source_view_id", "viewport_element_id");
CREATE INDEX "idx_revit_views_project_source" ON "revit_views"("project_id", "source_view_id");

CREATE INDEX "idx_revit_room_overlays_project_sheet" ON "revit_room_overlays"("project_id", "sheet_id");
CREATE INDEX "idx_revit_room_overlays_room" ON "revit_room_overlays"("room_id");

ALTER TABLE "revit_sheets"
  ADD CONSTRAINT "revit_sheets_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revit_sheets"
  ADD CONSTRAINT "revit_sheets_revit_model_id_fkey"
  FOREIGN KEY ("revit_model_id") REFERENCES "revit_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "revit_views"
  ADD CONSTRAINT "revit_views_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revit_views"
  ADD CONSTRAINT "revit_views_revit_model_id_fkey"
  FOREIGN KEY ("revit_model_id") REFERENCES "revit_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "revit_views"
  ADD CONSTRAINT "revit_views_sheet_id_fkey"
  FOREIGN KEY ("sheet_id") REFERENCES "revit_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revit_room_overlays"
  ADD CONSTRAINT "revit_room_overlays_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revit_room_overlays"
  ADD CONSTRAINT "revit_room_overlays_sheet_id_fkey"
  FOREIGN KEY ("sheet_id") REFERENCES "revit_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revit_room_overlays"
  ADD CONSTRAINT "revit_room_overlays_view_id_fkey"
  FOREIGN KEY ("view_id") REFERENCES "revit_views"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revit_room_overlays"
  ADD CONSTRAINT "revit_room_overlays_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

REVOKE ALL ON TABLE
  "revit_sheets",
  "revit_views",
  "revit_room_overlays"
FROM anon, authenticated;

ALTER TABLE "revit_sheets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revit_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revit_room_overlays" ENABLE ROW LEVEL SECURITY;
