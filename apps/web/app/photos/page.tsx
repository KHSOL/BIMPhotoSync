"use client";

import { AlertCircle, Bot, CheckCircle2, CircleDashed, ImagePlus, Search, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, canAccessAdminBoards, Photo, Project, readProjectId, readSession, Room, saveProjectId, TradeCategory, User } from "../client";
import { defaultSurfaceOptions, defaultTradeOptions, labelForOption, legacyTradeValue, type PhotoOption } from "../photo-options";

type PhotoTab = "list" | "upload";
type ProjectList = { data: Project[] };
type RoomList = { data: Room[] };
type PhotoList = { data: Photo[]; total: number };
type TradeCategoryList = { data: TradeCategory[] };
type TradeCategoryResult = { data: TradeCategory };
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
  const [file, setFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<PhotoTab>("list");
  const [newTradeLabel, setNewTradeLabel] = useState("");
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
    work_date: new Date().toISOString().slice(0, 10),
    worker_name: "",
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
    setUploadMeta((current) => ({ ...current, worker_name: session.user.name }));
    const params = new URLSearchParams(window.location.search);
    const storedProjectId = params.get("project_id") ?? readProjectId();
    const storedRoomId = params.get("room_id") ?? "";
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

  function resetFilters() {
    setRoomId("");
    setFilterTrade("");
    setFilterSurface("");
    setDateFrom("");
    setDateTo("");
    void loadPhotos(token, projectId, "", { trade: "", surface: "", from: "", to: "" }).catch((err: Error) => setStatus(err.message));
  }

  async function uploadPhoto() {
    if (!file || !projectId || !roomId) {
      setStatus("사진, 프로젝트, 방을 모두 선택하세요.");
      return;
    }
    setUploading(true);
    setUploadNotice("");
    setStatus("사진을 업로드하는 중입니다.");
    try {
      const mime = file.type || "image/jpeg";
      const presign = await apiJson<PresignResult>("/uploads/photos/presign", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, mime_type: mime, file_size: file.size })
      });
      const putRes = await fetch(presign.data.presigned_url, { method: presign.data.method, headers: { "Content-Type": mime }, body: file });
      if (!putRes.ok) throw new Error(`파일 업로드 실패: ${putRes.status}`);
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
          worker_name: uploadMeta.worker_name || user?.name || undefined
        })
      });
      setFile(null);
      setFilterTrade("");
      setFilterSurface("");
      setDateFrom("");
      setDateTo("");
      setActiveTab("list");
      await loadPhotos(token, projectId, roomId, { trade: "", surface: "", from: "", to: "" });
      setSelectedId(committed.data.id);
      setUploadNotice("사진 업로드가 완료됐습니다. AI 분석 큐에 등록했고, 아래 사진 조회 목록에서 바로 확인할 수 있습니다.");
      setStatus("사진 업로드가 완료됐고 AI 분석 큐에 등록됐습니다.");
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

  async function addTradeCategory() {
    const label = newTradeLabel.trim();
    if (!label || !projectId) return;
    const json = await apiJson<TradeCategoryResult>(`/projects/${projectId}/trade-categories`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ label })
    });
    setTradeCategories((current) => [...current, json.data]);
    setNewTradeLabel("");
    setStatus("공종 분류를 추가했습니다.");
  }

  async function removeTradeCategory(categoryId: string) {
    if (!projectId) return;
    const category = tradeCategories.find((trade) => trade.id === categoryId);
    if (!category || category.is_system) return;
    if (!window.confirm(`${category.label} 공종을 삭제할까요?`)) return;
    await apiJson<TradeCategoryResult>(`/projects/${projectId}/trade-categories/${categoryId}`, { method: "DELETE", headers: authHeaders(token) });
    setTradeCategories((current) => current.filter((trade) => trade.id !== categoryId));
    if (uploadMeta.trade_category_id === categoryId) setUploadMeta((current) => ({ ...current, trade_category_id: "", trade: "OTHER" }));
    if (filterTrade === `category:${categoryId}`) setFilterTrade("");
    setStatus(`${category.label} 공종을 삭제했습니다.`);
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

      <section className="toolbar-panel">
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
        {activeTab === "list" ? (
          <>
            <label className="field compact">
              <span className="label">공종</span>
              <select className="input" value={filterTrade} onChange={(event) => setFilterTrade(event.target.value)}>
                <option value="">전체</option>
                {tradeOptions.map((trade) => <option key={trade.value} value={trade.value}>{trade.label}</option>)}
              </select>
            </label>
            <label className="field compact">
              <span className="label">공사면</span>
              <select className="input" value={filterSurface} onChange={(event) => setFilterSurface(event.target.value)}>
                <option value="">전체</option>
                {defaultSurfaceOptions.map((surface) => <option key={surface.value} value={surface.value}>{surface.label}</option>)}
              </select>
            </label>
            <label className="field compact"><span className="label">시작일</span><input className="input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label className="field compact"><span className="label">종료일</span><input className="input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            <button className="button" onClick={() => loadPhotos().catch((err: Error) => setStatus(err.message))} type="button"><Search size={16} /> 조회</button>
            <button className="filter-button" onClick={resetFilters} type="button">전체보기</button>
          </>
        ) : null}
      </section>

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
            <div className="panel-header"><h2 className="panel-title">선택 사진 상세</h2><span className="badge orange">{progressStatusLabel(selectedPhoto?.progress_status)}</span></div>
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

          <aside className="panel photo-query-panel">
            <div className="panel-header"><h2 className="panel-title">조회 기준</h2></div>
            <div className="status-card"><span className="muted">선택 방</span><strong>{selectedRoom ? `${selectedRoom.room_number ?? ""} ${selectedRoom.room_name}` : "전체 방"}</strong><code>{selectedRoom?.bim_photo_room_id ?? "BIM_PHOTO_ROOM_ID"}</code></div>
            <div style={{ height: 12 }} />
            <div className="status-card"><span className="muted">조회 상태</span><div className="badge-row"><span className="badge green">API 조회</span><span className="badge blue">미리보기</span><span className="badge orange">AI 요약</span></div></div>
            <p className="muted">{status}</p>
          </aside>
        </div>
      ) : null}

      {activeTab === "upload" ? (
        <section className="panel">
          <div className="panel-header"><div><h2 className="panel-title">사진 업로드</h2><p className="muted">프로젝트, 방, 공사면, 공종, 작업일자, 작업자, 내용을 함께 저장합니다.</p></div><UploadCloud size={18} color="#2563eb" /></div>
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
            <Field label="작업일자"><input className="input" type="date" value={uploadMeta.work_date} onChange={(event) => setUploadMeta({ ...uploadMeta, work_date: event.target.value })} /></Field>
            <label className="field upload-note"><span className="label">내용</span><textarea className="input textarea" value={uploadMeta.description} onChange={(event) => setUploadMeta({ ...uploadMeta, description: event.target.value })} /></label>
            <Field label="작업자"><input className="input" value={uploadMeta.worker_name} onChange={(event) => setUploadMeta({ ...uploadMeta, worker_name: event.target.value })} placeholder="예: 최반장" /></Field>
            <Field label="사진"><input className="input file-input" type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
            <button className="button upload-button" disabled={uploading} onClick={() => uploadPhoto().catch((err: Error) => setStatus(err.message))} type="button">
              <UploadCloud size={16} /> {uploading ? "업로드 중" : "업로드"}
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === "upload" && canManageFilters ? (
        <section className="panel filter-manager-panel">
          <div className="panel-header"><div><h2 className="panel-title">공종 분류 관리</h2><p className="muted">관리자는 업로드에 사용할 사용자 지정 공종을 추가하거나 삭제할 수 있습니다.</p></div></div>
          <div className="filter-manager-grid">
            <label className="field"><span className="label">추가할 공종명</span><input className="input" value={newTradeLabel} onChange={(event) => setNewTradeLabel(event.target.value)} placeholder="예: 석고보드" /></label>
            <button className="button" type="button" onClick={() => addTradeCategory().catch((err: Error) => setStatus(err.message))}>공종 추가</button>
          </div>
          <div className="filter-chip-row">
            {tradeCategories.filter((trade) => !trade.is_system).length === 0 ? <span className="muted">추가된 사용자 지정 공종이 없습니다.</span> : null}
            {tradeCategories.filter((trade) => !trade.is_system).map((trade) => (
              <button className="filter-chip danger" key={trade.id} type="button" onClick={() => removeTradeCategory(trade.id).catch((err: Error) => setStatus(err.message))} aria-label={`${trade.label} 공종 삭제`}>
                <Trash2 size={14} />
                <span>{trade.label}</span>
                <strong>삭제</strong>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "upload" ? (
        <div className="bottom-grid">
          <section className="panel">
            <div className="panel-header"><h2 className="panel-title">업로드 흐름</h2><UploadCloud size={18} color="#2563eb" /></div>
            <div className="queue-list">
              <QueueItem icon={<CheckCircle2 size={16} color="#22c55e" />} name="업로드 URL 발급" value="100%" />
              <QueueItem icon={<CircleDashed size={16} color="#2563eb" />} name="저장소 업로드" value="100%" />
              <QueueItem icon={<AlertCircle size={16} color="#f59e0b" />} name="AI 검토" value="자동 등록" />
            </div>
          </section>
          <section className="panel">
            <div className="panel-header"><h2 className="panel-title">AI 분석 상태</h2><Bot size={18} color="#2563eb" /></div>
            <div className="badge-row"><span className="badge green">저장 완료</span><span className="badge blue">분석 큐 등록</span><span className="badge orange">관리자 검토 가능</span></div>
            <p className="muted">업로드 후 분석 작업이 사진을 확인하고 분석 요약을 저장합니다. 관리자는 사진 조회 탭에서 분석 결과를 수정해 공정 상태와 보고서 근거에 반영할 수 있습니다.</p>
          </section>
        </div>
      ) : null}

      <p className="muted">{status}</p>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="label">{label}</span>{children}</label>;
}

function QueueItem({ icon, name, value }: { icon: React.ReactNode; name: string; value: string }) {
  return <div className="queue-item">{icon}<span>{name}</span><strong>{value}</strong></div>;
}

function progressStatusLabel(status?: string) {
  if (status === "COMPLETED") return "완료";
  if (status === "BLOCKED") return "이슈";
  if (status === "IN_PROGRESS") return "진행 중";
  return "검토 대기";
}
