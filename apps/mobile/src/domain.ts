export const trades = [
  ["WATERPROOF", "방수"],
  ["TILE", "타일"],
  ["PAINT", "도장"],
  ["ELECTRIC", "전기"],
  ["MEP", "설비"],
  ["WINDOW", "창호"],
  ["CONCRETE", "콘크리트"],
  ["OTHER", "기타"]
] as const;

export const surfaces = [
  ["FLOOR", "바닥"],
  ["WALL", "벽"],
  ["CEILING", "천장"],
  ["WINDOW", "창"],
  ["DOOR", "문"],
  ["PIPE", "배관"],
  ["ELECTRIC", "전기"],
  ["OTHER", "기타"]
] as const;

export type AppTab = "home" | "projects" | "profile";
export type AuthMode = "login" | "register";
export type RegisterRole = "WORKER" | "COMPANY_ADMIN";
export type SurfaceCode = (typeof surfaces)[number][0];
export type TradeCode = (typeof trades)[number][0];
export type RoomProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
export type PillTone = "blue" | "green" | "yellow" | "red" | "gray";

export type Project = {
  id: string;
  name: string;
  code: string;
  member_role?: string | null;
  created_at?: string | null;
};

export type Room = {
  id: string;
  bim_photo_room_id: string;
  room_name: string;
  room_number?: string | null;
  level_name?: string | null;
  progress_by_surface?: Partial<Record<SurfaceCode, { status: RoomProgressStatus; photo_count: number }>>;
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
  progress_status: string;
  photo_url: string;
  uploaded_at: string;
  room?: Room;
};

export type User = {
  email: string;
  name: string;
  role: string;
  company_name?: string | null;
};

export type AuthResponse = {
  data: {
    access_token: string;
    user: User;
  };
};

export type UploadMeta = {
  work_surface: SurfaceCode;
  trade: TradeCode;
  description: string;
};

export type RoomSection = {
  title: string;
  data: Room[];
};
