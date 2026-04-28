"use client";

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  KeyRound,
  Search,
  UploadCloud
} from "lucide-react";
import { useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://bimphotosync-api-production.up.railway.app/api/v1";

const demoPhotos = [
  {
    id: "demo-1",
    room_id: "demo-room",
    room: { level_name: "3F", room_number: "101", room_name: "욕실" },
    work_surface: "FLOOR",
    trade: "WATERPROOF",
    work_date: "2026-03-05",
    worker_name: "김작업",
    description: "배수구 주변 2차 방수 진행",
    ai_description: "배수구 주변 추가 확인이 필요합니다. 바닥 방수 시공 전 표면 청소 상태를 점검하세요.",
    progress_status: "IN_PROGRESS",
    photo_url:
      "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=900&q=80"
  },
  {
    id: "demo-2",
    room_id: "demo-room",
    room: { level_name: "3F", room_number: "101", room_name: "욕실" },
    work_surface: "WALL",
    trade: "MEP",
    work_date: "2026-03-04",
    worker_name: "박설비",
    description: "배관 위치 확인",
    ai_description: "벽체 관통부 주변 보양 확인이 필요합니다.",
    progress_status: "PENDING_REVIEW",
    photo_url:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80"
  }
];

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
  const [email, setEmail] = useState("dev@bim.local");
  const [password, setPassword] = useState("password123");
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("b4e070af-eaf2-4820-b111-acc2592df50b");
  const [roomId, setRoomId] = useState("");
  const [trade, setTrade] = useState("");
  const [workSurface, setWorkSurface] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState("demo-1");
  const [status, setStatus] = useState("원격 API에 연결한 뒤 Room 기준 사진을 조회하세요.");

  const visiblePhotos = photos.length > 0 ? photos : demoPhotos;
  const selectedPhoto = useMemo(
    () => visiblePhotos.find((photo) => photo.id === selectedId) ?? visiblePhotos[0],
    [selectedId, visiblePhotos]
  );

  async function login() {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "로그인 실패");
    setToken(json.data.access_token);
    setStatus(`${json.data.user.email} 계정으로 연결되었습니다.`);
  }

  async function loadPhotos() {
    const params = new URLSearchParams({ project_id: projectId });
    if (roomId) params.set("room_id", roomId);
    if (trade) params.set("trade", trade);
    if (workSurface) params.set("work_surface", workSurface);
    const res = await fetch(`${API_BASE}/photos?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "사진 조회 실패");
    setPhotos(json.data);
    setSelectedId(json.data[0]?.id ?? "demo-1");
    setStatus(`${json.total}개 사진을 조회했습니다.`);
  }

  return (
    <>
      <div className="breadcrumb">
        <span>Project</span>
        <ChevronRight size={14} />
        <span>3F</span>
        <ChevronRight size={14} />
        <strong>101 욕실</strong>
      </div>

      <section className="panel">
        <div className="toolbar">
          <Field label="Email">
            <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Project ID">
            <input className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button secondary" onClick={() => login().catch((err) => setStatus(err.message))}>
              <KeyRound size={16} /> 연결
            </button>
            <button className="button" onClick={() => loadPhotos().catch((err) => setStatus(err.message))}>
              <Search size={16} /> 조회
            </button>
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h1 className="panel-title">Photo Grid</h1>
              <div className="muted">{photos.length > 0 ? `${photos.length} Photos` : "데모 사진으로 UI 미리보기"}</div>
            </div>
            <span className="badge blue">Room 기준</span>
          </div>
          <div className="photo-grid">
            {visiblePhotos.map((photo) => (
              <button
                className={`photo-tile ${photo.id === selectedPhoto.id ? "active" : ""}`}
                key={photo.id}
                onClick={() => setSelectedId(photo.id)}
                type="button"
              >
                <img src={photo.photo_url} alt={photo.description ?? "현장 사진"} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Selected Photo Details</h2>
            <span className="badge orange">{selectedPhoto.progress_status}</span>
          </div>
          <div className="detail-layout">
            <div className="detail-photo">
              <img src={selectedPhoto.photo_url} alt={selectedPhoto.description ?? "선택 사진"} />
            </div>
            <dl className="meta-list">
              <dt>촬영 일시</dt>
              <dd>{selectedPhoto.work_date}</dd>
              <dt>공종</dt>
              <dd>{selectedPhoto.trade}</dd>
              <dt>면</dt>
              <dd>{selectedPhoto.work_surface}</dd>
              <dt>업로드 사용자</dt>
              <dd>{selectedPhoto.worker_name ?? "-"}</dd>
              <dt>위치</dt>
              <dd>
                {selectedPhoto.room?.level_name ?? "-"} &gt; {selectedPhoto.room?.room_number ?? ""}{" "}
                {selectedPhoto.room?.room_name ?? selectedPhoto.room_id}
              </dd>
            </dl>
          </div>
          <div className="callout">
            <div className="callout-title">
              <Bot size={18} color="#2563eb" /> AI Summary
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {selectedPhoto.ai_description ?? "분석 대기 중입니다."}
            </p>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Room Status</h2>
          </div>
          <div className="status-card">
            <span className="muted">진행 상태</span>
            <div className="ring-row">
              <div className="ring" style={{ "--progress": "72%" } as React.CSSProperties}>
                <span>72%</span>
              </div>
              <div>
                <strong>진행중</strong>
                <div className="muted">방수공사 / 101 욕실</div>
              </div>
            </div>
          </div>
          <div style={{ height: 12 }} />
          <div className="status-card">
            <span className="muted">사진 API</span>
            <div className="badge-row">
              <span className="badge green">Railway API</span>
              <span className="badge blue">Supabase DB</span>
              <span className="badge blue">Cloudflare R2</span>
            </div>
          </div>
          <p className="muted">{status}</p>
        </aside>
      </div>

      <div className="bottom-grid">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Upload Pipeline</h2>
            <UploadCloud size={18} color="#2563eb" />
          </div>
          <div className="queue-list">
            <QueueItem icon={<CheckCircle2 size={16} color="#22c55e" />} name="Presigned URL" value="100%" />
            <QueueItem icon={<CircleDashed size={16} color="#2563eb" />} name="Object Storage" value="65%" />
            <QueueItem icon={<AlertCircle size={16} color="#f59e0b" />} name="Metadata Review" value="45%" />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">AI Analysis Status</h2>
            <Bot size={18} color="#2563eb" />
          </div>
          <div className="badge-row">
            <span className="badge green">완료 128</span>
            <span className="badge blue">분석 중 34</span>
            <span className="badge orange">대기 중 16</span>
          </div>
          <p className="muted">사진 업로드 후 worker가 queue를 처리하고 분석 결과를 내용란에 저장합니다.</p>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Revit Link</h2>
            <ClipboardList size={18} color="#2563eb" />
          </div>
          <p className="muted">Revit Room 선택은 BIM_PHOTO_ROOM_ID 기준으로 사진 API를 호출합니다.</p>
          <div className="progress">
            <span style={{ "--value": "100%" } as React.CSSProperties} />
          </div>
        </section>
      </div>
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

function QueueItem({ icon, name, value }: { icon: React.ReactNode; name: string; value: string }) {
  return (
    <div className="queue-item">
      {icon}
      <span>{name}</span>
      <strong>{value}</strong>
      <div style={{ gridColumn: "2 / 4" }} className="progress">
        <span style={{ "--value": value } as React.CSSProperties} />
      </div>
    </div>
  );
}
