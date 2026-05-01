ALTER TABLE "revit_floor_plans"
  ADD COLUMN "asset_object_key" TEXT,
  ADD COLUMN "asset_mime_type" TEXT,
  ADD COLUMN "asset_width_px" INTEGER,
  ADD COLUMN "asset_height_px" INTEGER,
  ADD COLUMN "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
