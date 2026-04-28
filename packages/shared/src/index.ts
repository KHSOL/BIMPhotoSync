export const WORK_SURFACES = [
  "FLOOR",
  "WALL",
  "CEILING",
  "WINDOW",
  "DOOR",
  "PIPE",
  "ELECTRIC",
  "OTHER"
] as const;

export const TRADES = [
  "WATERPROOF",
  "TILE",
  "PAINT",
  "ELECTRIC",
  "MEP",
  "WINDOW",
  "CONCRETE",
  "OTHER"
] as const;

export const PROGRESS_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "BLOCKED",
  "PENDING_REVIEW"
] as const;

export type WorkSurface = (typeof WORK_SURFACES)[number];
export type Trade = (typeof TRADES)[number];
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export type PhotoMetadataInput = {
  project_id: string;
  room_id: string;
  upload_id: string;
  work_surface: WorkSurface;
  trade: Trade;
  work_date: string;
  worker_name?: string | null;
  description?: string | null;
  taken_at?: string | null;
};

