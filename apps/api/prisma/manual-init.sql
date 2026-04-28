CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('WORKER','MANAGER','PROJECT_ADMIN','BIM_MANAGER','COMPANY_ADMIN','VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProjectMemberRole" AS ENUM ('WORKER','MANAGER','PROJECT_ADMIN','BIM_MANAGER','VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkSurface" AS ENUM ('FLOOR','WALL','CEILING','WINDOW','DOOR','PIPE','ELECTRIC','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "Trade" AS ENUM ('WATERPROOF','TILE','PAINT','ELECTRIC','MEP','WINDOW','CONCRETE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED','IN_PROGRESS','COMPLETED','BLOCKED','PENDING_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RowStatus" AS ENUM ('ACTIVE','ARCHIVED','DELETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AiProvider" AS ENUM ('OPENAI','HEURISTIC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role "UserRole" NOT NULL DEFAULT 'WORKER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  access_key_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  role "ProjectMemberRole" NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS revit_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  model_name TEXT NOT NULL,
  document_guid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name TEXT NOT NULL,
  elevation DOUBLE PRECISION,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  revit_model_id UUID REFERENCES revit_models(id) ON DELETE SET NULL ON UPDATE CASCADE,
  level_id UUID REFERENCES levels(id) ON DELETE SET NULL ON UPDATE CASCADE,
  bim_photo_room_id TEXT NOT NULL UNIQUE,
  revit_unique_id TEXT UNIQUE,
  revit_element_id TEXT,
  room_number TEXT,
  room_name TEXT NOT NULL,
  level_name TEXT,
  area_m2 NUMERIC(12,2),
  location_text TEXT,
  status "RowStatus" NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rooms_project_level_name ON rooms(project_id, level_name, room_name);

CREATE TABLE IF NOT EXISTS photo_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  checksum_sha256 TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  committed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  work_surface "WorkSurface" NOT NULL,
  trade "Trade" NOT NULL,
  work_date DATE NOT NULL,
  worker_name TEXT,
  description TEXT,
  ai_description TEXT,
  progress_status "ProgressStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  storage_provider TEXT NOT NULL DEFAULT 'S3',
  object_key TEXT NOT NULL,
  thumbnail_key TEXT,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  checksum_sha256 TEXT,
  taken_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status "RowStatus" NOT NULL DEFAULT 'ACTIVE'
);

CREATE INDEX IF NOT EXISTS idx_photos_project_room_workdate_desc ON photos(project_id, room_id, work_date DESC, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_project_trade_surface_date ON photos(project_id, trade, work_surface, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_by_date ON photos(uploaded_by, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS photo_ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE ON UPDATE CASCADE,
  model_provider "AiProvider" NOT NULL,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  result_json JSONB NOT NULL,
  summary TEXT NOT NULL,
  detected_trade "Trade",
  detected_surface "WorkSurface",
  progress_status "ProgressStatus" NOT NULL,
  confidence NUMERIC(5,4) NOT NULL,
  requires_human_review BOOLEAN NOT NULL DEFAULT true,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_ai_review_queue ON photo_ai_analyses(created_at DESC) WHERE requires_human_review = true;
CREATE INDEX IF NOT EXISTS gin_photo_ai_result_json ON photo_ai_analyses USING GIN(result_json);
