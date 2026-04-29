-- Server-owned RLS backstop for BIM Photo Sync.
-- Authorization remains in the Nest API. These policies prevent accidental
-- Supabase anon/authenticated direct table access while preserving Prisma access
-- through the owner/server database connection.

REVOKE ALL ON TABLE
  "companies",
  "users",
  "projects",
  "project_members",
  "revit_models",
  "revit_floor_plans",
  "levels",
  "rooms",
  "photo_uploads",
  "photos",
  "photo_ai_analyses",
  "generated_reports"
FROM anon, authenticated;

REVOKE ALL ON TABLE "_prisma_migrations" FROM anon, authenticated;

ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revit_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revit_floor_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photo_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photo_ai_analyses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generated_reports" ENABLE ROW LEVEL SECURITY;
