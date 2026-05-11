ALTER TYPE "ReportFormat" ADD VALUE IF NOT EXISTS 'XLSX';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_object_key" TEXT;

CREATE TABLE IF NOT EXISTS "trade_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "project_id" UUID,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trade_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trade_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trade_categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_trade_categories_scope_code" ON "trade_categories"("company_id", "project_id", "code");
CREATE INDEX IF NOT EXISTS "idx_trade_categories_scope_active" ON "trade_categories"("company_id", "project_id", "is_active");

ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "trade_category_id" UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'photos_trade_category_id_fkey') THEN
    ALTER TABLE "photos" ADD CONSTRAINT "photos_trade_category_id_fkey"
      FOREIGN KEY ("trade_category_id") REFERENCES "trade_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "project_id" UUID,
  "actor_user_id" UUID,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "detail" TEXT,
  "metadata" JSONB,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "audit_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_audit_events_project_created" ON "audit_events"("project_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_events_company_created" ON "audit_events"("company_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "auth_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID,
  "user_id" UUID,
  "email" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "auth_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_auth_events_company_created" ON "auth_events"("company_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_auth_events_user_created" ON "auth_events"("user_id", "created_at" DESC);
