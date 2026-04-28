"use client";

import { Search } from "lucide-react";
import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type Photo = {
  id: string;
  room_id: string;
  room?: { room_name?: string; room_number?: string; level_name?: string };
  work_surface: string;
  trade: string;
  work_date: string;
  worker_name?: string;
  description?: string;
  ai_description?: string;
  progress_status: string;
  photo_url: string;
  latest_analysis?: { confidence?: string; requiresHumanReview?: boolean };
};

export default function PhotosPage() {
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [trade, setTrade] = useState("");
  const [workSurface, setWorkSurface] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState("필터를 입력하고 조회하세요.");

  async function loadPhotos() {
    const params = new URLSearchParams({ project_id: projectId });
    if (roomId) params.set("room_id", roomId);
    if (trade) params.set("trade", trade);
    if (workSurface) params.set("work_surface", workSurface);
    const res = await fetch(`${API_BASE}/photos?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "사진 조회 실패");
    setPhotos(json.data);
    setStatus(`${json.total}개 사진 조회됨`);
  }

  return (
    <>
      <section>
        <h1 style={{ fontSize: 24, lineHeight: "32px", margin: 0 }}>사진 관리</h1>
        <p className="muted">Room 기준으로 현장 사진과 AI 분석 결과를 조회합니다.</p>
      </section>

      <section className="panel">
        <div className="toolbar">
          <Field label="JWT Token">
            <input className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} />
          </Field>
          <Field label="Project ID">
            <input className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
          </Field>
          <Field label="Room ID">
            <input className="input" value={roomId} onChange={(event) => setRoomId(event.target.value)} />
          </Field>
          <Field label="Trade">
            <select className="input" value={trade} onChange={(event) => setTrade(event.target.value)}>
              <option value="">전체</option>
              <option>WATERPROOF</option>
              <option>TILE</option>
              <option>PAINT</option>
              <option>ELECTRIC</option>
              <option>MEP</option>
            </select>
          </Field>
          <Field label="Surface">
            <select className="input" value={workSurface} onChange={(event) => setWorkSurface(event.target.value)}>
              <option value="">전체</option>
              <option>FLOOR</option>
              <option>WALL</option>
              <option>CEILING</option>
              <option>PIPE</option>
            </select>
          </Field>
          <button className="button" onClick={() => loadPhotos().catch((err) => setStatus(err.message))}>
            <Search size={16} /> 조회
          </button>
        </div>
      </section>

      <div className="muted">{status}</div>

      <section className="photo-grid">
        {photos.map((photo) => (
          <article key={photo.id} className="photo-card">
            <img className="thumb" src={photo.photo_url} alt={photo.description ?? "현장 사진"} />
            <div className="photo-body">
              <strong>
                {photo.room?.level_name ?? "-"} / {photo.room?.room_number ?? ""} {photo.room?.room_name ?? photo.room_id}
              </strong>
              <div className="badge-row">
                <span className="badge blue">{photo.work_surface}</span>
                <span className="badge blue">{photo.trade}</span>
                <span className="badge orange">{photo.progress_status}</span>
              </div>
              <span className="muted">
                {photo.work_date} · {photo.worker_name ?? "작업자 미입력"}
              </span>
              <p className="muted">{photo.description ?? "설명 없음"}</p>
              <p className="muted">AI: {photo.ai_description ?? "분석 대기"}</p>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
