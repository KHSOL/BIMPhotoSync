export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://bimphotosync-api-production.up.railway.app/api/v1";

export type User = {
  id: string;
  company_id: string;
  email: string;
  name: string;
  role: string;
};

export const upperManagerRoles = ["COMPANY_ADMIN", "PROJECT_ADMIN", "BIM_MANAGER"] as const;

export function isUpperManager(user: User | null | undefined) {
  return !!user && upperManagerRoles.includes(user.role as (typeof upperManagerRoles)[number]);
}

export type Project = {
  id: string;
  company_id: string;
  name: string;
  code: string;
  member_role?: string | null;
};

export type Room = {
  id: string;
  project_id: string;
  bim_photo_room_id: string;
  revit_unique_id?: string | null;
  revit_element_id?: string | null;
  room_number?: string | null;
  room_name: string;
  level_name?: string | null;
  location_text?: string | null;
  status: string;
};

export type PlanPoint = {
  x: number;
  y: number;
};

export type PlanBounds = {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  width: number;
  height: number;
};

export type FloorPlanRoom = {
  room_id?: string | null;
  bim_photo_room_id: string;
  revit_unique_id: string;
  revit_element_id: string;
  room_number?: string | null;
  room_name: string;
  level_name?: string | null;
  area_m2?: number | null;
  center: PlanPoint;
  polygon: PlanPoint[];
};

export type RevitFloorPlan = {
  id: string;
  project_id: string;
  revit_model_id?: string | null;
  level_name: string;
  view_name: string;
  source_view_id?: string | null;
  bounds: PlanBounds;
  rooms: FloorPlanRoom[];
  created_at: string;
};

export type Photo = {
  id: string;
  project_id: string;
  room_id: string;
  work_surface: string;
  trade: string;
  work_date: string;
  worker_name?: string | null;
  description?: string | null;
  ai_description?: string | null;
  progress_status: string;
  photo_url: string;
  uploaded_at: string;
  room?: Room;
  preview_url?: string;
  latest_analysis?: {
    confidence?: string;
    requiresHumanReview?: boolean;
    summary?: string;
  } | null;
};

export type GeneratedReport = {
  id: string;
  project_id: string;
  project?: Project;
  title: string;
  format: string;
  status: string;
  filters: Record<string, string | null>;
  content: {
    title: string;
    generated_at: string;
    generated_by: string;
    filters: Record<string, string | null>;
    situation: Record<string, string | null>;
    comparison_photos: Array<{
      photo_id: string;
      work_date: string;
      room: string;
      work_surface: string;
      trade: string;
      worker_name?: string | null;
      description?: string | null;
      ai_description?: string | null;
    }>;
    progress_timeline: string[];
    analysis_result: string;
    memo?: string | null;
  };
  summary?: string | null;
  photo_ids: string[];
  model_provider: string;
  model_name: string;
  error_message?: string | null;
  created_by: Pick<User, "id" | "name" | "email" | "role">;
  created_at: string;
  updated_at: string;
};

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function readSession() {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("bps_token");
  const user = window.localStorage.getItem("bps_user");
  if (!token || !user) return null;
  return { token, user: JSON.parse(user) as User };
}

export function saveSession(token: string, user: User) {
  window.localStorage.setItem("bps_token", token);
  window.localStorage.setItem("bps_user", JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem("bps_token");
  window.localStorage.removeItem("bps_user");
  window.localStorage.removeItem("bps_project_id");
}

export function readProjectId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("bps_project_id") ?? "";
}

export function saveProjectId(projectId: string) {
  window.localStorage.setItem("bps_project_id", projectId);
}

export async function apiJson<T>(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message ?? json?.message ?? `API error ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }
  return json as T;
}
