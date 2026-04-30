DROP INDEX IF EXISTS "rooms_revit_unique_id_key";

CREATE UNIQUE INDEX "uq_rooms_project_revit_unique_id"
ON "rooms"("project_id", "revit_unique_id");
