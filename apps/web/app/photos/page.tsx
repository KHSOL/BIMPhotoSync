"use client";

import { Bot, CheckCircle2, ImagePlus, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, canAccessAdminBoards, Photo, Project, readProjectId, readSession, Room, saveProjectId, TradeCategory, User } from "../client";
import { defaultSurfaceOptions, defaultTradeOptions, labelForOption, legacyTradeValue, type PhotoOption } from "../photo-options";

type PhotoTab = "list" | "upload";
type ProjectList = { data: Project[] };
type RoomList = { data: Room[] };
type PhotoList = { data: Photo[]; total: number };
type TradeCategoryList = { data: TradeCategory[] };
type PresignResult = { data: { upload_id: string; presigned_url: string; method: "PUT" } };
type CommitResult = { data: Photo };
type ReviewResult = { data: unknown };

const progressOptions = [
  { value: "PENDING_REVIEW", label: "검토 대기" },
  { value: "IN_PROGRESS", label: "진행 중" },
  { value: "COMPLETED", label: "완료" },
  { value: "BLOCKED", label: "이슈" }
];

export default function PhotosPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tradeCategories, setTradeCategories] = useState<TradeCategory[]>([]);
  const [filterTrade, setFilterTrade] = useState("");
  const [filterSurface, setFilterSurface] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [activeTab, setActiveTab] = useState<PhotoTab>("list");
  const [reviewSummary, setReviewSummary] = useState("");
  const [reviewTrade, setReviewTrade] = useState("");
  const [reviewSurface, setReviewSurface] = useState("");
  const [reviewProgress, setReviewProgress] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadMeta, setUploadMeta] = useState({
    work_surface: "FLOOR",
    trade: "WATERPROOF",
    trade_category_id: "",
    description: ""
  });
  const [status, setStatus] = useState("로그인 후 프로젝트와 방을 선택하세요.");

  const selectedPhoto = useMemo(() => photos.find((photo) => photo.id === selectedId) ?? photos[0], [photos, selectedId]);
  const selectedRoom = rooms.find((room) => room.id === roomId);
  const tradeOptions: PhotoOption[] = tradeCategories.length
    ? tradeCategories.map((category) => ({ value: `category:${category.id}`, label: category.label, isSystem: category.is_system }))
    : defaultTradeOptions;
  const uploadTradeOptions: PhotoOption[] = tradeCategories.length
    ? tradeCategories.map((category) => ({ value: category.id, label: category.label, isSystem: category.is_system }))
    : defaultTradeOptions;
  const canManageFilters = canAccessAdminBoards(user);

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    setUser(session.user);
    const params = new URLSearchParams(window.location.search);
    const storedProjectId = params.get("project_id") ?? readProjectId();
    const storedRoomId = params.get("room_id") ?? "";
    const requestedTab = params.get("tab");
    if (requestedTab === "upload" || requestedTab === "list") setActiveTab(requestedTab);
    setProjectId(storedProjectId);
    setRoomId(storedRoomId);
    void loadProjects(session.token, storedProjectId, storedRoomId);
  }, []);

  useEffect(() => {
    setReviewSummary(selectedPhoto?.ai_description ?? selectedPhoto?.latest_analysis?.summary ?? selectedPhoto?.description ?? "");
    setReviewTrade(selectedPhoto?.trade ?? "OTHER");
    setReviewSurface(selectedPhoto?.work_surface ?? "WALL");
    setReviewProgress(selectedPhoto?.progress_status ?? "PENDING_REVIEW");
  }, [selectedPhoto?.id, selectedPhoto?.ai_description, selectedPhoto?.latest_analysis?.summary, selectedPhoto?.progress_status, selectedPhoto?.trade, selectedPhoto?.work_surface]);

  async function loadProjects(nextToken = token, preferredProjectId = projectId, preferredRoomId = roomId) {
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const nextProjectId = json.data.some((project) => project.id === preferredProjectId) ? preferredProjectId : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadTradeCategories(nextToken, nextProjectId);
      const nextRoomId = await loadRooms(nextToken, nextProjectId, preferredRoomId);
      await loadPhotos(nextToken, nextProjectId, nextRoomId);
    }
  }

  async function loadTradeCategories(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<TradeCategoryList>(`/projects/${nextProjectId}/trade-categories`, { headers: authHeaders(nextToken) });
    setTradeCategories(json.data);
    setUploadMeta((current) => ({ ...current, trade_category_id: current.trade_category_id || json.data[0]?.id || "" }));
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId, preferredRoomId = roomId) {
    if (!nextProjectId) return "";
    const json = await apiJson<RoomList>(`/projects/${nextProjectId}/rooms`, { headers: authHeaders(nextToken) });
    setRooms(json.data);
    const nextRoomId = json.data.some((room) => room.id === preferredRoomId) ? preferredRoomId : preferredRoomId ? "" : json.data[0]?.id ?? "";
    setRoomId(nextRoomId);
    return nextRoomId;
  }

  async function loadPhotos(
    nextToken = token,
    nextProjectId = projectId,
    nextRoomId = roomId,
    nextFilters = { trade: filterTrade, surface: filterSurface, from: dateFrom, to: dateTo }
  ) {
    if (!nextProjectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    const params = new URLSearchParams({ project_id: nextProjectId });
    if (nextRoomId) params.set("room_id", nextRoomId);
    if (nextFilters.trade) {
      if (nextFilters.trade.startsWith("category:")) params.set("trade_category_id", nextFilters.trade.replace(/^category:/, ""));
      else params.set("trade", nextFilters.trade);
    }
    if (nextFilters.surface) params.set("work_surface", nextFilters.surface);
    if (nextFilters.from) params.set("date_from", nextFilters.from);
    if (nextFilters.to) params.set("date_to", nextFilters.to);
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
    void loadTradeCategories(token, nextProjectId).catch((err: Error) => setStatus(err.message));
    void loadRooms(token, nextProjectId).catch((err: Error) => setStatus(err.message));
    if (activeTab === "list") void loadPhotos(token, nextProjectId, "").catch((err: Error) => setStatus(err.message));
    else setStatus("업로드할 프로젝트를 변경했습니다.");
  }

  function changeRoom(nextRoomId: string) {
    setRoomId(nextRoomId);
    void loadPhotos(token, projectId, nextRoomId).catch((err: Error) => setStatus(err.message));
  }

  function changeTradeFilter(nextTrade: string) {
    setFilterTrade(nextTrade);
    void loadPhotos(token, projectId, roomId, { trade: nextTrade, surface: filterSurface, from: dateFrom, to: dateTo }).catch((err: Error) => setStatus(err.message));
  }

  function changeSurfaceFilter(nextSurface: string) {
    setFilterSurface(nextSurface);
    void loadPhotos(token, projectId, roomId, { trade: filterTrade, surface: nextSurface, from: dateFrom, to: dateTo }).catch((err: Error) => setStatus(err.message));
  }

  function changeDateFrom(nextDate: string) {
    setDateFrom(nextDate);
    void loadPhotos(token, projectId, roomId, { trade: filterTrade, surface: filterSurface, from: nextDate, to: dateTo }).catch((err: Error) => setStatus(err.message));
  }

  function changeDateTo(nextDate: string) {
    setDateTo(nextDate);
    void loadPhotos(token, projectId, roomId, { trade: filterTrade, surface: filterSurface, from: dateFrom, to: nextDate }).catch((err: Error) => setStatus(err.message));
  }

  async function uploadPhoto() {
    if (files.length === 0 || !projectId || !roomId) {
      setStatus("사진, 프로젝트, 방을 모두 선택하세요.");
      return;
    }
    setUploading(true);
    setUploadNotice("");
    setStatus(`${files.length}개 사진을 업로드하는 중입니다.`);
    try {
      let lastCommitted: Photo | null = null;
      for (const uploadFile of files) {
        const mime = uploadFile.type || "image/jpeg";
        const presign = await apiJson<PresignResult>("/uploads/photos/presign", {
          method: "POST",
          headers: { ...authHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, mime_type: mime, file_size: uploadFile.size })
        });
        const putRes = await fetch(presign.data.presigned_url, { method: presign.data.method, headers: { "Content-Type": mime }, body: uploadFile });
        if (!putRes.ok) throw new Error(`파일 업로드 실패: ${putRes.status}`);
        const uploadedAt = new Date();
        const committed = await apiJson<CommitResult>("/photos", {
          method: "POST",
          headers: { ...authHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            room_id: roomId,
            upload_id: presign.data.upload_id,
            ...uploadMeta,
            trade: legacyTradeValue(uploadMeta.trade),
            trade_category_id: uploadMeta.trade_category_id || undefined,
            work_date: uploadedAt.toISOString().slice(0, 10),
            worker_name: user?.name || undefined,
            taken_at: uploadedAt.toISOString()
          })
        });
        lastCommitted = committed.data;
      }
      setFiles([]);
      setFilterTrade("");
      setFilterSurface("");
      setDateFrom("");
      setDateTo("");
      setActiveTab("list");
      await loadPhotos(token, projectId, roomId, { trade: "", surface: "", from: "", to: "" });
      setSelectedId(lastCommitted?.id ?? "");
      setUploadNotice(`${files.length}개 사진 업로드가 완료됐습니다. AI 분석 큐에 등록했고, 아래 사진 조회 목록에서 바로 확인할 수 있습니다.`);
      setStatus(`${files.length}개 사진 업로드가 완료됐고 AI 분석 큐에 등록됐습니다.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setUploading(false);
    }
  }

  async function reviewAnalysis() {
    if (!selectedPhoto) return;
    setReviewing(true);
    try {
      await apiJson<ReviewResult>(`/photos/${selectedPhoto.id}/analysis/review`, {
        method: "PATCH",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: reviewSummary || undefined,
          detected_trade: reviewTrade || undefined,
          detected_surface: reviewSurface || undefined,
          progress_status: reviewProgress || undefined
        })
      });
      setStatus("AI 분석 검토 결과를 저장했습니다. 이 피드백은 사진 상태와 이후 보고서 근거에 반영됩니다.");
      await loadPhotos();
    } finally {
      setReviewing(false);
    }
  }

  return (
    <main className="app-main">
      <section className="page-hero compact">
        <div>
          <span className="eyebrow"><ImagePlus size={16} /> Photos</span>
          <h1>사진</h1>
          <p>현장 사진을 방, 공사면, 공종, 작업일자, 작업자 기준으로 저장하고 AI 분석 결과를 검토합니다.</p>
        </div>
        <div className="hero-actions">
          <button className={activeTab === "list" ? "button" : "filter-button"} type="button" onClick={() => setActiveTab("list")}>사진 조회</button>
          <button className={activeTab === "upload" ? "button" : "filter-button"} type="button" onClick={() => setActiveTab("upload")}>사진 업로드</button>
        </div>
      </section>

      {activeTab === "list" ? (
        <section className="toolbar-panel photo-filter-bar">
          <label className="field compact">
            <span className="label">프로젝트</span>
            <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name} / {project.code}</option>)}
            </select>
          </label>
          <label className="field compact">
            <span className="label">방</span>
            <select className="input" value={roomId} onChange={(event) => changeRoom(event.target.value)}>
              <option value="">전체 방</option>
              {rooms.map((room) => <option key={room.id} value={room.id}>{room.level_name ?? "-"} / {room.room_number ?? ""} {room.room_name}</option>)}
            </select>
          </label>
            <label className="field compact">
              <span className="label">공종</span>
              <select className="input" value={filterTrade} onChange={(event) => changeTradeFilter(event.target.value)}>
                <option value="">전체</option>
                {tradeOptions.map((trade) => <option key={trade.value} value={trade.value}>{trade.label}</option>)}
              </select>
            </label>
            <label className="field compact">
              <span className="label">공사면</span>
              <select className="input" value={filterSurface} onChange={(event) => changeSurfaceFilter(event.target.value)}>
                <option value="">전체</option>
                {defaultSurfaceOptions.map((surface) => <option key={surface.value} value={surface.value}>{surface.label}</option>)}
              </select>
            </label>
            <label className="field compact"><span className="label">시작일</span><input className="input" type="date" value={dateFrom} onChange={(event) => changeDateFrom(event.target.value)} /></label>
            <label className="field compact"><span className="label">종료일</span><input className="input" type="date" value={dateTo} onChange={(event) => changeDateTo(event.target.value)} /></label>
        </section>
      ) : null}

      {uploadNotice ? (
        <div className="success-notice" role="status">
          <CheckCircle2 size={18} />
          <span>{uploadNotice}</span>
        </div>
      ) : null}

      {activeTab === "list" ? (
        <div className="dashboard-grid photo-dashboard-grid">
          <section className="panel photo-list-panel">
            <div className="panel-header">
              <div><h1 className="panel-title">사진 조회</h1><div className="muted">사진 {photos.length}개</div></div>
              <span className="badge blue">방 기준</span>
            </div>
            {photos.length === 0 ? (
              <div className="empty"><div><ImagePlus size={28} /><p>조건에 맞는 사진이 없습니다.</p><p className="muted">프로젝트, 방, 공종, 기간 조건을 다시 확인하세요.</p></div></div>
            ) : (
              <div className="photo-grid">
                {photos.map((photo) => (
                  <button className={`photo-tile ${photo.id === selectedPhoto?.id ? "active" : ""}`} key={photo.id} onClick={() => setSelectedId(photo.id)} type="button">
                    {photo.preview_url ? <img src={photo.preview_url} alt={photo.description ?? "현장 사진"} /> : <div className="photo-fallback" />}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel photo-detail-panel">
            <div className="panel-header">
              <h2 className="panel-title">선택 사진 상세</h2>
              <span className={roomProgressStatus(selectedRoom, tradeCategories).badgeClass}>{roomProgressStatus(selectedRoom, tradeCategories).label}</span>
            </div>
            {selectedRoom ? (
              <div className="photo-room-context">
                <span className="muted">선택 방</span>
                <strong>{selectedRoom.room_number ? `${selectedRoom.room_number} ` : ""}{selectedRoom.room_name}</strong>
                <code>{selectedRoom.bim_photo_room_id}</code>
              </div>
            ) : null}
            {selectedPhoto ? (
              <>
                <div className="detail-layout">
                  <div className="detail-photo">{selectedPhoto.preview_url ? <img src={selectedPhoto.preview_url} alt={selectedPhoto.description ?? "선택 사진"} /> : <div className="photo-fallback" />}</div>
                  <dl className="meta-list">
                    <dt>작업일자</dt><dd>{selectedPhoto.work_date}</dd>
                    <dt>공종</dt><dd>{selectedPhoto.trade_category?.label ?? labelForOption(defaultTradeOptions, selectedPhoto.trade)}</dd>
                    <dt>공사면</dt><dd>{labelForOption(defaultSurfaceOptions, selectedPhoto.work_surface)}</dd>
                    <dt>작업자</dt><dd>{selectedPhoto.worker_name ?? "-"}</dd>
                    <dt>위치</dt><dd>{selectedPhoto.room?.level_name ?? "-"} &gt; {selectedPhoto.room?.room_number ?? ""} {selectedPhoto.room?.room_name ?? selectedPhoto.room_id}</dd>
                  </dl>
                </div>
                <div className="callout"><div className="callout-title"><Bot size={18} color="#2563eb" /> AI 요약</div><p className="muted" style={{ margin: 0 }}>{selectedPhoto.ai_description ?? selectedPhoto.latest_analysis?.summary ?? "분석 대기 중입니다."}</p></div>
                <div className="callout"><div className="callout-title">작업 내용</div><p className="muted" style={{ margin: 0 }}>{selectedPhoto.description ?? "-"}</p></div>
                {canManageFilters ? (
                  <div className="callout">
                    <div className="callout-title"><CheckCircle2 size={18} color="#16a34a" /> AI 분석 검토</div>
                    <label className="field"><span className="label">검토 요약</span><textarea className="input textarea" value={reviewSummary} onChange={(event) => setReviewSummary(event.target.value)} /></label>
                    <div className="filter-manager-grid">
                      <Field label="공종">
                        <select className="input" value={reviewTrade} onChange={(event) => setReviewTrade(event.target.value)}>
                          {defaultTradeOptions.map((trade) => <option key={trade.value} value={trade.value}>{trade.label}</option>)}
                        </select>
                      </Field>
                      <Field label="공사면">
                        <select className="input" value={reviewSurface} onChange={(event) => setReviewSurface(event.target.value)}>
                          {defaultSurfaceOptions.map((surface) => <option key={surface.value} value={surface.value}>{surface.label}</option>)}
                        </select>
                      </Field>
                      <Field label="공정 상태">
                        <select className="input" value={reviewProgress} onChange={(event) => setReviewProgress(event.target.value)}>
                          {progressOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </Field>
                      <button className="button" type="button" disabled={reviewing} onClick={() => reviewAnalysis().catch((err: Error) => setStatus(err.message))}>
                        {reviewing ? "저장 중" : "검토 결과 저장"}
                      </button>
                    </div>
                    <p className="muted">관리자 검토값은 최신 AI 분석과 사진 공정 상태에 저장되어 방 공정 색상과 보고서 근거에 반영됩니다.</p>
                  </div>
                ) : null}
              </>
            ) : <div className="empty">사진을 선택하세요.</div>}
          </section>
        </div>
      ) : null}

      {activeTab === "upload" ? (
        <section className="panel">
          <div className="panel-header"><div><h2 className="panel-title">사진 업로드</h2><p className="muted">작업일자와 작성자는 업로드 시점과 로그인 사용자로 자동 저장됩니다.</p></div><UploadCloud size={18} color="#2563eb" /></div>
          <div className="upload-grid">
            <Field label="프로젝트명">
              <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name} / {project.code}</option>)}
              </select>
            </Field>
            <Field label="방">
              <select className="input" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                <option value="">방 선택</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{room.level_name ?? "-"} / {room.room_number ?? ""} {room.room_name}</option>)}
              </select>
            </Field>
            <Field label="공사면">
              <select className="input" value={uploadMeta.work_surface} onChange={(event) => setUploadMeta({ ...uploadMeta, work_surface: event.target.value })}>
                {defaultSurfaceOptions.map((surface) => <option key={surface.value} value={surface.value}>{surface.label}</option>)}
              </select>
            </Field>
            <Field label="공종">
              <select className="input" value={uploadMeta.trade_category_id || uploadMeta.trade} onChange={(event) => {
                const category = tradeCategories.find((trade) => trade.id === event.target.value);
                setUploadMeta({ ...uploadMeta, trade_category_id: category?.id ?? "", trade: category?.code ?? event.target.value });
              }}>
                {uploadTradeOptions.map((trade) => <option key={trade.value} value={trade.value}>{trade.label}</option>)}
              </select>
            </Field>
            <label className="field upload-note"><span className="label">내용</span><textarea className="input textarea" value={uploadMeta.description} onChange={(event) => setUploadMeta({ ...uploadMeta, description: event.target.value })} /></label>
            <Field label="사진">
              <input className="input file-input" type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
            </Field>
            <div className="fixed-upload-meta">
              <span className="label">작업일자 / 작성자</span>
              <strong>업로드 시점 자동 저장</strong>
              <small>{user?.name ?? "로그인 사용자"}</small>
            </div>
            <button className="button upload-button" disabled={uploading} onClick={() => uploadPhoto().catch((err: Error) => setStatus(err.message))} type="button">
              <UploadCloud size={16} /> {uploading ? "업로드 중" : files.length > 1 ? `${files.length}개 업로드` : "업로드"}
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === "upload" ? <p className="muted">{status}</p> : null}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="label">{label}</span>{children}</label>;
}

function roomProgressStatus(room: Room | undefined, tradeCategories: TradeCategory[]) {
  const values = roomTradeProgressValues(room, tradeCategories);
  if (values.length > 0 && values.every((item) => item.status === "COMPLETED")) return { label: "완료", badgeClass: "badge green" };
  if (values.some((item) => item.status === "IN_PROGRESS" || item.status === "COMPLETED")) return { label: "진행중", badgeClass: "badge orange" };
  return { label: "시작 전", badgeClass: "badge red" };
}

function roomTradeProgressValues(room: Room | undefined, tradeCategories: TradeCategory[]) {
  if (!room) return [];
  return tradeCategories.map((category) => room.progress_by_trade_category?.[category.id] ?? { status: "NOT_STARTED" as const, photo_count: 0 });
}
