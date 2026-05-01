"use client";

import { Building2, Camera, FolderKanban, KeyRound, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, isSuperAdmin, readSession, User } from "../client";

type AdminOverview = {
  data: {
    totals: {
      companies: number;
      projects: number;
      users: number;
      rooms: number;
      photos: number;
      revit_models: number;
    };
    companies: Array<{
      id: string;
      name: string;
      user_count: number;
      project_count: number;
      projects: Array<{
        id: string;
        name: string;
        code: string;
        room_count: number;
        photo_count: number;
        revit_model_count: number;
        floor_plan_count: number;
      }>;
    }>;
    recent_photos: Array<{
      id: string;
      project: { name: string; code: string; company: { name: string } };
      room: { room_name: string; room_number?: string | null };
      uploaded_by: { name: string; email: string };
      work_surface: string;
      trade: string;
      uploaded_at: string;
    }>;
  };
};

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<AdminOverview["data"] | null>(null);
  const [status, setStatus] = useState("SUPER_ADMIN 권한으로 전체 운영 현황을 조회합니다.");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    setUser(session.user);
    if (isSuperAdmin(session.user)) {
      void loadOverview(session.token).catch((err) => setStatus(err.message));
    }
  }, []);

  async function loadOverview(nextToken = token) {
    const json = await apiJson<AdminOverview>("/admin/overview", { headers: authHeaders(nextToken) });
    setOverview(json.data);
    setStatus("전체 운영 현황을 불러왔습니다.");
  }

  const totals = useMemo(() => overview?.totals, [overview]);

  if (!token) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <a className="button" href="/login">로그인으로 이동</a>
      </section>
    );
  }

  if (!isSuperAdmin(user)) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">SUPER_ADMIN 전용 화면입니다</h1>
        <p className="muted">회사 관리자는 Projects, Rooms, Floor Plan에서 본인 회사 프로젝트를 관리합니다.</p>
      </section>
    );
  }

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="page-subtitle">회사, 프로젝트, Room, 사진, Revit 연결 상태를 전체 조회합니다.</p>
        </div>
        <button className="filter-button" type="button" onClick={() => loadOverview().catch((err) => setStatus(err.message))}>
          <RefreshCw size={16} />
          새로고침
        </button>
      </header>

      <section className="metric-grid">
        <Metric icon={<Building2 size={21} />} label="회사" value={totals?.companies ?? 0} />
        <Metric icon={<FolderKanban size={21} />} label="프로젝트" value={totals?.projects ?? 0} />
        <Metric icon={<Users size={21} />} label="사용자" value={totals?.users ?? 0} />
        <Metric icon={<Building2 size={21} />} label="Room" value={totals?.rooms ?? 0} />
        <Metric icon={<Camera size={21} />} label="사진" value={totals?.photos ?? 0} />
        <Metric icon={<Building2 size={21} />} label="Revit 모델" value={totals?.revit_models ?? 0} />
      </section>

      <section className="admin-grid">
        <article className="panel ref-card">
          <h2 className="section-title">회사 / 프로젝트</h2>
          <div className="admin-company-list">
            {(overview?.companies ?? []).map((company) => (
              <div className="admin-company" key={company.id}>
                <div>
                  <strong>{company.name}</strong>
                  <span>{company.user_count} users · {company.project_count} projects</span>
                </div>
                <div className="admin-project-list">
                  {company.projects.map((project) => (
                    <div key={project.id}>
                      <strong>{project.name}</strong>
                      <span>{project.code} · Rooms {project.room_count} · Photos {project.photo_count} · Revit {project.revit_model_count}/{project.floor_plan_count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel ref-card">
          <h2 className="section-title">최근 업로드 사진</h2>
          <div className="admin-photo-list">
            {(overview?.recent_photos ?? []).map((photo) => (
              <div key={photo.id}>
                <strong>{photo.project.company.name} / {photo.project.name}</strong>
                <span>{photo.room.room_number ?? ""} {photo.room.room_name} · {photo.trade} · {photo.work_surface}</span>
                <small>{photo.uploaded_by.name} · {new Date(photo.uploaded_at).toLocaleString("ko-KR")}</small>
              </div>
            ))}
          </div>
        </article>
      </section>
      <p className="muted">{status}</p>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <article className="metric-card">
      <span className="metric-icon blue">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value.toLocaleString("ko-KR")}</strong>
      </div>
    </article>
  );
}
