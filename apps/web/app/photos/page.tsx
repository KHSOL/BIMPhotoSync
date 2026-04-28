"use client";

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  ImagePlus,
  KeyRound,
  Search,
  UploadCloud
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, Photo, Project, readProjectId, readSession, Room, saveProjectId } from "../client";

const trades = ["WATERPROOF", "TILE", "PAINT", "ELECTRIC", "MEP", "WINDOW", "CONCRETE", "OTHER"];
const surfaces = ["FLOOR", "WALL", "CEILING", "WINDOW", "DOOR", "PIPE", "ELECTRIC", "OTHER"];

type ProjectList = { data: Project[] };
type RoomList = { data: Room[] };
type PhotoList = { data: Photo[]; total: number };
type PresignResult = { data: { upload_id: string; presigned_url: string; method: "PUT" } };
type CommitResult = { data: Photo };

export default function PhotosPage() {
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filterTrade, setFilterTrade] = useState("");
  const [filterSurface, setFilterSurface] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadMeta, setUploadMeta] = useState({
    work_surface: "FLOOR",
    trade: "WATERPROOF",
    work_date: new Date().toISOString().slice(0, 10),
    worker_name: "",
    description: ""
  });
  const [status, setStatus] = useState("로그인 후 프로젝트와 Room을 선택하세요.");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    const storedProjectId = readProjectId();
    setProjectId(storedProjectId);
    void loadProjects(session.token, storedProjectId);
  }, []);

  async function loadProjects(nextToken = token, preferredProjectId = projectId) {
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const nextProjectId = json.data.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadRooms(nextToken, nextProjectId);
      await loadPhotos(nextToken, nextProjectId, "");
    }
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<RoomList>(`/projects/${nextProjectId}/rooms`, { headers: authHeaders(nextToken) });
    setRooms(json.data);
    if (!roomId && json.data[0]) setRoomId(json.data[0].id);
  }

  async function loadPhotos(nextToken = token, nextProjectId = projectId, nextRoomId = roomId) {
    if (!nextProjectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    const params = new URLSearchParams({ project_id: nextProjectId });
    if (nextRoomId) params.set("room_id", nextRoomId);
    if (filterTrade) params.set("trade", filterTrade);
    if (filterSurface) params.set("work_surface", filterSurface);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const json = await apiJson<PhotoList>(`/photos?${params}`, { headers: authHeaders(nextToken) });
    const hydrated = await hydratePreviews(nextToken, json.data);
    setPhotos(hydrated);
    setSelectedId(hydrated[0]?.id ?? "");
    setStatus(`${json.total}개 사진을 시간순으로 불러왔습니다.`);
  }

  async function hydratePreviews(nextToken: string, rows: Photo[]) {
    return Promise.all(
      rows.map(async (photo) => {
        try {
          const res = await fetch(photo.photo_url, { headers: authHeaders(nextToken) });
          if (!res.ok) return photo;
          const blob = await res.blob();
          return { ...photo, preview_url: URL.createObjectURL(blob) };
        } catch {
          return photo;
        }
      })
    );
  }

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    saveProjectId(nextProjectId);
    setRoomId("");
    void loadRooms(token, nextProjectId).catch((err) => setStatus(err.message));
    void loadPhotos(token, nextProjectId, "").catch((err) => setStatus(err.message));
  }

  async function uploadPhoto() {
    if (!file || !projectId || !roomId) {
      setStatus("사진, 프로젝트, Room을 모두 선택하세요.");
      return;
    }
    const mime = file.type || "image/jpeg";
    const presign = await apiJson<PresignResult>("/uploads/photos/presign", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, mime_type: mime, file_size: file.size })
    });
    const putRes = await fetch(presign.data.presigned_url, {
      method: presign.data.method,
      headers: { "Content-Type": mime },
      body: file
    });
    if (!putRes.ok) throw new Error(`Object upload failed: ${putRes.status}`);
    await apiJson<CommitResult>("/photos", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        room_id: roomId,
        upload_id: presign.data.upload_id,
        ...uploadMeta
      })
    });
    setFile(null);
    setStatus("사진 업로드가 완료됐고 AI 분석 큐에 등록됐습니다.");
    await loadPhotos();
  }

  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedId) ?? photos[0],
    [photos, selectedId]
  );
  const selectedRoom = rooms.find((room) => room.id === roomId);

  if (!token) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">사진 업로드와 조회는 회사/프로젝트 권한 안에서만 가능합니다.</p>
        <a className="button" href="/login">
          로그인으로 이동
        </a>
      </section>
    );
  }

  return (
    <>
      <div className="breadcrumb">
        <span>Project</span>
        <ChevronRight size={14} />
        <span>{selectedRoom?.level_name ?? "Room"}</span>
        <ChevronRight size={14} />
        <strong>
          {selectedRoom ? `${selectedRoom.room_number ?? ""} ${selectedRoom.room_name}` : "사진 관리"}
        </strong>
      </div>

      <section className="panel">
        <div className="toolbar photo-toolbar">
          <Field label="Project">
            <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} / {project.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room">
            <select className="input" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              <option value="">전체 Room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.level_name ?? "-"} / {room.room_number ?? ""} {room.room_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Trade">
            <select className="input" value={filterTrade} onChange={(event) => setFilterTrade(event.target.value)}>
              <option value="">전체</option>
              {trades.map((trade) => (
                <option key={trade}>{trade}</option>
              ))}
            </select>
          </Field>
          <Field label="Surface">
            <select className="input" value={filterSurface} onChange={(event) => setFilterSurface(event.target.value)}>
              <option value="">전체</option>
              {surfaces.map((surface) => (
                <option key={surface}>{surface}</option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input className="input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </Field>
          <button className="button" onClick={() => loadPhotos().catch((err) => setStatus(err.message))} type="button">
            <Search size={16} /> 조회
          </button>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h1 className="panel-title">Photo Grid</h1>
              <div className="muted">{photos.length} Photos</div>
            </div>
            <span className="badge blue">Room 기준</span>
          </div>
          {photos.length === 0 ? (
            <div className="empty">
              <div>
                <ImagePlus size={28} />
                <p>아직 사진이 없습니다.</p>
                <p className="muted">아래 업로드 패널에서 Room에 사진을 연결하세요.</p>
              </div>
            </div>
          ) : (
            <div className="photo-grid">
              {photos.map((photo) => (
                <button
                  className={`photo-tile ${photo.id === selectedPhoto?.id ? "active" : ""}`}
                  key={photo.id}
                  onClick={() => setSelectedId(photo.id)}
                  type="button"
                >
                  {photo.preview_url ? <img src={photo.preview_url} alt={photo.description ?? "현장 사진"} /> : <div className="photo-fallback" />}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Selected Photo Details</h2>
            <span className="badge orange">{selectedPhoto?.progress_status ?? "EMPTY"}</span>
          </div>
          {selectedPhoto ? (
            <>
              <div className="detail-layout">
                <div className="detail-photo">
                  {selectedPhoto.preview_url ? (
                    <img src={selectedPhoto.preview_url} alt={selectedPhoto.description ?? "선택 사진"} />
                  ) : (
                    <div className="photo-fallback" />
                  )}
                </div>
                <dl className="meta-list">
                  <dt>작업일자</dt>
                  <dd>{selectedPhoto.work_date}</dd>
                  <dt>공종</dt>
                  <dd>{selectedPhoto.trade}</dd>
                  <dt>공사면</dt>
                  <dd>{selectedPhoto.work_surface}</dd>
                  <dt>작업자</dt>
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
                  {selectedPhoto.ai_description ?? selectedPhoto.latest_analysis?.summary ?? "분석 대기 중입니다."}
                </p>
              </div>
              <div className="callout">
                <div className="callout-title">작업 내용</div>
                <p className="muted" style={{ margin: 0 }}>
                  {selectedPhoto.description ?? "-"}
                </p>
              </div>
            </>
          ) : (
            <div className="empty">사진을 선택하세요.</div>
          )}
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Room Status</h2>
          </div>
          <div className="status-card">
            <span className="muted">선택 Room</span>
            <strong>
              {selectedRoom ? `${selectedRoom.room_number ?? ""} ${selectedRoom.room_name}` : "전체 Room"}
            </strong>
            <code>{selectedRoom?.bim_photo_room_id ?? "BIM_PHOTO_ROOM_ID"}</code>
          </div>
          <div style={{ height: 12 }} />
          <div className="status-card">
            <span className="muted">사진 처리</span>
            <div className="badge-row">
              <span className="badge green">R2 업로드</span>
              <span className="badge blue">AI 큐</span>
              <span className="badge orange">관리자 검토</span>
            </div>
          </div>
          <p className="muted">{status}</p>
        </aside>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">사진 업로드</h2>
            <p className="muted">프로젝트, 실, 공사면, 공종, 작업일자, 작업자, 내용을 함께 저장합니다.</p>
          </div>
          <UploadCloud size={18} color="#2563eb" />
        </div>
        <div className="upload-grid">
          <Field label="Room">
            <select className="input" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              <option value="">Room 선택</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.level_name ?? "-"} / {room.room_number ?? ""} {room.room_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Surface">
            <select
              className="input"
              value={uploadMeta.work_surface}
              onChange={(event) => setUploadMeta({ ...uploadMeta, work_surface: event.target.value })}
            >
              {surfaces.map((surface) => (
                <option key={surface}>{surface}</option>
              ))}
            </select>
          </Field>
          <Field label="Trade">
            <select
              className="input"
              value={uploadMeta.trade}
              onChange={(event) => setUploadMeta({ ...uploadMeta, trade: event.target.value })}
            >
              {trades.map((trade) => (
                <option key={trade}>{trade}</option>
              ))}
            </select>
          </Field>
          <Field label="Work Date">
            <input
              className="input"
              type="date"
              value={uploadMeta.work_date}
              onChange={(event) => setUploadMeta({ ...uploadMeta, work_date: event.target.value })}
            />
          </Field>
          <Field label="Worker">
            <input
              className="input"
              value={uploadMeta.worker_name}
              onChange={(event) => setUploadMeta({ ...uploadMeta, worker_name: event.target.value })}
            />
          </Field>
          <Field label="Photo">
            <input className="input file-input" type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </Field>
          <label className="field upload-note">
            <span className="label">내용</span>
            <textarea
              className="input textarea"
              value={uploadMeta.description}
              onChange={(event) => setUploadMeta({ ...uploadMeta, description: event.target.value })}
            />
          </label>
          <button className="button upload-button" onClick={() => uploadPhoto().catch((err) => setStatus(err.message))} type="button">
            <UploadCloud size={16} /> 업로드
          </button>
        </div>
      </section>

      <div className="bottom-grid">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Upload Pipeline</h2>
            <UploadCloud size={18} color="#2563eb" />
          </div>
          <div className="queue-list">
            <QueueItem icon={<CheckCircle2 size={16} color="#22c55e" />} name="Presigned URL" value="100%" />
            <QueueItem icon={<CircleDashed size={16} color="#2563eb" />} name="Object Storage" value="100%" />
            <QueueItem icon={<AlertCircle size={16} color="#f59e0b" />} name="AI Review" value="45%" />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">AI Analysis Status</h2>
            <Bot size={18} color="#2563eb" />
          </div>
          <div className="badge-row">
            <span className="badge green">저장 완료</span>
            <span className="badge blue">분석 큐 등록</span>
            <span className="badge orange">검토 대기</span>
          </div>
          <p className="muted">업로드 후 worker가 사진을 분석하고 분석 요약을 내용란과 AI Summary에 저장합니다.</p>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Revit Link</h2>
            <ClipboardList size={18} color="#2563eb" />
          </div>
          <p className="muted">Revit Add-in은 Room 선택 시 BIM_PHOTO_ROOM_ID로 같은 사진 조회 API를 호출합니다.</p>
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
