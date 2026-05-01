"use client";

import {
  Box,
  Camera,
  ChevronRight,
  Crosshair,
  FileText,
  Filter,
  KeyRound,
  Layers,
  MousePointer2,
  Move,
  Ruler,
  Search,
  Settings,
  Star,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  apiJson,
  authHeaders,
  FloorPlanRoom,
  Photo,
  Project,
  readProjectId,
  readSession,
  RevitFloorPlan,
  RevitRoomOverlay,
  RevitSheet,
  saveProjectId
} from "../client";

type DrawingViewerMode = "floorPlans" | "sheets";
type ProjectList = { data: Project[] };
type FloorPlanList = { data: RevitFloorPlan[] };
type SheetList = { data: RevitSheet[] };
type RoomPhotosResponse = { data: { photos: Photo[] } };
type PdfJsModule = typeof import("pdfjs-dist");
type PdfRenderState = "idle" | "loading" | "ready" | "error";

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      return module;
    });
  }
  return pdfJsModulePromise;
}

export default function DrawingViewer({ mode }: { mode: DrawingViewerMode }) {
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [plans, setPlans] = useState<RevitFloorPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [floorPlanAssetUrl, setFloorPlanAssetUrl] = useState("");
  const [sheets, setSheets] = useState<RevitSheet[]>([]);
  const [sheetId, setSheetId] = useState("");
  const [sheetAssetUrl, setSheetAssetUrl] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [activeTool, setActiveTool] = useState<"select" | "measure" | "note" | "section" | "settings">("select");
  const [treeQuery, setTreeQuery] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState(
    mode === "floorPlans"
      ? "Revit Add-in에서 Sync Floor Plans를 실행하면 Floor Plan 구역이 표시됩니다."
      : "Revit Add-in에서 Sync Sheets를 실행하면 Sheet와 Room 구역이 표시됩니다."
  );

  const isFloorPlanMode = mode === "floorPlans";
  const pageTitle = isFloorPlanMode ? "Floor Plan" : "Sheets";
  const selectedPlan = useMemo(
    () => (isFloorPlanMode ? plans.find((plan) => plan.id === planId) ?? plans[0] : undefined),
    [isFloorPlanMode, planId, plans]
  );
  const selectedSheet = useMemo(
    () => (!isFloorPlanMode ? sheets.find((sheet) => sheet.id === sheetId) ?? sheets[0] : undefined),
    [isFloorPlanMode, sheetId, sheets]
  );
  const allPlanRooms = useMemo(() => plans.flatMap((plan) => plan.rooms), [plans]);
  const selectedPlanRoom = useMemo(
    () => (isFloorPlanMode ? allPlanRooms.find((room) => room.bim_photo_room_id === selectedRoomId) : undefined),
    [allPlanRooms, isFloorPlanMode, selectedRoomId]
  );
  const selectedOverlay = useMemo(
    () => (!isFloorPlanMode ? selectedSheet?.overlays.find((overlay) => overlay.bim_photo_room_id === selectedRoomId) : undefined),
    [isFloorPlanMode, selectedRoomId, selectedSheet]
  );
  const selectedRoom = isFloorPlanMode ? selectedPlanRoom : selectedOverlay;
  const selectedRoomArea = isFloorPlanMode ? selectedPlanRoom?.area_m2 ?? null : selectedOverlay?.room?.area_m2 ?? null;
  const visibleSheets = useMemo(() => {
    const query = treeQuery.trim().toLowerCase();
    if (!query) return sheets;
    return sheets.filter((sheet) => `${sheet.sheet_number} ${sheet.sheet_name}`.toLowerCase().includes(query));
  }, [sheets, treeQuery]);
  const visiblePlans = useMemo(() => {
    const query = treeQuery.trim().toLowerCase();
    if (!query) return plans;
    return plans.filter((plan) => `${plan.level_name} ${plan.view_name}`.toLowerCase().includes(query));
  }, [plans, treeQuery]);
  const selectedPhotosHref =
    getRoomDatabaseId(selectedRoom) !== "" ? `/photos?project_id=${projectId}&room_id=${getRoomDatabaseId(selectedRoom)}` : "/photos";

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    void loadProjects(session.token).catch((err: Error) => setStatus(err.message));
  }, []);

  useEffect(() => {
    if (!token || !selectedRoomId) {
      setPhotos([]);
      return;
    }
    void loadRoomPhotos(selectedRoomId).catch((err: Error) => setStatus(err.message));
  }, [token, selectedRoomId]);

  useEffect(() => {
    if (!isFloorPlanMode || !token || !selectedPlan?.asset?.url) {
      setFloorPlanAssetUrl("");
      return;
    }

    let objectUrl = "";
    let cancelled = false;
    void fetch(selectedPlan.asset.url, { headers: authHeaders(token) })
      .then((res) => {
        if (!res.ok) throw new Error(`Floor plan asset ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setFloorPlanAssetUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFloorPlanAssetUrl("");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isFloorPlanMode, selectedPlan?.id, selectedPlan?.asset?.url, token]);

  useEffect(() => {
    if (isFloorPlanMode || !token || !selectedSheet?.asset?.url) {
      setSheetAssetUrl("");
      return;
    }

    let objectUrl = "";
    let cancelled = false;
    void fetch(selectedSheet.asset.url, { headers: authHeaders(token) })
      .then((res) => {
        if (!res.ok) throw new Error(`Sheet asset ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setSheetAssetUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSheetAssetUrl("");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isFloorPlanMode, selectedSheet?.id, selectedSheet?.asset?.url, token]);

  async function loadProjects(nextToken = token) {
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const storedProjectId = readProjectId();
    const nextProjectId = json.data.some((project) => project.id === storedProjectId) ? storedProjectId : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadProjectGeometry(nextToken, nextProjectId);
    }
  }

  async function loadProjectGeometry(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const [floorPlanJson, sheetJson] = await Promise.all([
      apiJson<FloorPlanList>(`/revit/projects/${nextProjectId}/floor-plans`, { headers: authHeaders(nextToken) }),
      apiJson<SheetList>(`/revit/projects/${nextProjectId}/sheets`, { headers: authHeaders(nextToken) })
    ]);

    setPlans(floorPlanJson.data);
    setSheets(sheetJson.data);
    setPlanId(floorPlanJson.data[0]?.id ?? "");
    setSheetId(sheetJson.data[0]?.id ?? "");
    setSelectedRoomId(
      isFloorPlanMode
        ? floorPlanJson.data[0]?.rooms[0]?.bim_photo_room_id ?? ""
        : sheetJson.data[0]?.overlays[0]?.bim_photo_room_id ?? ""
    );

    if (isFloorPlanMode) {
      const roomCount = floorPlanJson.data.reduce((sum, plan) => sum + plan.rooms.length, 0);
      setStatus(
        floorPlanJson.data.length > 0
          ? `${floorPlanJson.data.length}개 Floor Plan과 ${roomCount}개 Room 구역을 불러왔습니다.`
          : "동기화된 Floor Plan이 없습니다."
      );
      return;
    }

    setStatus(
      sheetJson.data.length > 0
        ? `${sheetJson.data.length}개 Sheet와 ${sheetJson.data.reduce((sum, sheet) => sum + sheet.overlays.length, 0)}개 Room 구역을 불러왔습니다.`
        : "동기화된 Revit Sheet가 없습니다."
    );
  }

  async function loadRoomPhotos(bimPhotoRoomId: string) {
    const json = await apiJson<RoomPhotosResponse>(`/revit/rooms/${encodeURIComponent(bimPhotoRoomId)}/photos`, {
      headers: authHeaders(token)
    });
    setPhotos(await hydratePreviews(json.data.photos));
  }

  async function hydratePreviews(rows: Photo[]) {
    return Promise.all(
      rows.map(async (photo) => {
        try {
          const res = await fetch(photo.photo_url, { headers: authHeaders(token) });
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
    void loadProjectGeometry(token, nextProjectId).catch((err: Error) => setStatus(err.message));
  }

  function selectSheet(nextSheetId: string) {
    const nextSheet = sheets.find((sheet) => sheet.id === nextSheetId);
    setSheetId(nextSheetId);
    setSelectedRoomId(nextSheet?.overlays[0]?.bim_photo_room_id ?? "");
  }

  function selectPlan(nextPlanId: string) {
    const nextPlan = plans.find((plan) => plan.id === nextPlanId);
    setPlanId(nextPlanId);
    setSelectedRoomId(nextPlan?.rooms[0]?.bim_photo_room_id ?? "");
  }

  if (!token) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">{pageTitle}는 프로젝트 권한 안에서만 조회됩니다.</p>
        <a className="button" href="/login">
          로그인으로 이동
        </a>
      </section>
    );
  }

  return (
    <div className="reference-page viewer-page">
      <section className="viewer-toolbar panel">
        <label className="field compact">
          <span className="label">프로젝트</span>
          <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {isFloorPlanMode ? (
          <label className="field compact">
            <span className="label">Floor Plan</span>
            <select className="input" value={selectedPlan?.id ?? ""} onChange={(event) => selectPlan(event.target.value)}>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.level_name} · {plan.view_name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field compact">
            <span className="label">Sheet</span>
            <select className="input" value={selectedSheet?.id ?? ""} onChange={(event) => selectSheet(event.target.value)}>
              {sheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.sheet_number} · {sheet.sheet_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="tool-segment">
          <button className={activeTool === "select" ? "active" : ""} type="button" onClick={() => setActiveTool("select")}>
            <MousePointer2 size={17} />
            선택
          </button>
          <button className={activeTool === "measure" ? "active" : ""} type="button" onClick={() => setActiveTool("measure")}>
            <Ruler size={17} />
            측정
          </button>
          <button className={activeTool === "note" ? "active" : ""} type="button" onClick={() => setActiveTool("note")}>
            <Crosshair size={17} />
            주석
          </button>
          <button className={activeTool === "section" ? "active" : ""} type="button" onClick={() => setActiveTool("section")}>
            <Box size={17} />
            단면
          </button>
        </div>
        <div className="tool-segment small">
          <button className="active" type="button">
            2D
          </button>
          <button type="button" disabled>
            3D
          </button>
        </div>
        <button className="filter-button" type="button" onClick={() => loadProjectGeometry().catch((err: Error) => setStatus(err.message))}>
          <Filter size={16} />
          새로고침
        </button>
      </section>

      <section className="viewer-layout">
        <aside className="panel viewer-tree">
          <h2 className="section-title">{isFloorPlanMode ? "Floor Plan 목록" : "Sheet 목록"}</h2>
          <label className="search-box">
            <Search size={16} />
            <input
              value={treeQuery}
              onChange={(event) => setTreeQuery(event.target.value)}
              placeholder={isFloorPlanMode ? "Floor Plan 검색" : "Sheet 검색"}
            />
          </label>
          {isFloorPlanMode ? (
            <div className="tree-group">
              <strong>
                <Layers size={16} /> Revit Floor Plan
              </strong>
              {visiblePlans.map((plan) => (
                <button className={plan.id === selectedPlan?.id ? "active" : ""} key={plan.id} type="button" onClick={() => selectPlan(plan.id)}>
                  <span>
                    {plan.view_name}
                    <small>{plan.level_name}</small>
                  </span>
                  <small>{plan.rooms.length}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="tree-group">
              <strong>
                <FileText size={16} /> Revit Sheet
              </strong>
              {visibleSheets.map((sheet) => (
                <button className={sheet.id === selectedSheet?.id ? "active" : ""} key={sheet.id} type="button" onClick={() => selectSheet(sheet.id)}>
                  <span>
                    {sheet.sheet_number}
                    <small>{sheet.sheet_name}</small>
                  </span>
                  <small>{sheet.overlays.length}</small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="viewer-main">
          {isFloorPlanMode && selectedPlan ? (
            <FloorPlanSvg
              plan={selectedPlan}
              assetUrl={floorPlanAssetUrl}
              selectedRoomId={selectedRoomId}
              onSelect={setSelectedRoomId}
            />
          ) : !isFloorPlanMode && selectedSheet ? (
            <SheetViewer sheet={selectedSheet} assetUrl={sheetAssetUrl} selectedRoomId={selectedRoomId} onSelect={setSelectedRoomId} />
          ) : (
            <div className="floor-plan real-plan-empty">
              <KeyRound size={30} />
              <strong>{isFloorPlanMode ? "동기화된 Floor Plan이 없습니다" : "동기화된 Revit Sheet가 없습니다"}</strong>
              <span>{isFloorPlanMode ? "Revit에서 Sync Floor Plans를 실행하세요." : "Revit에서 Sync Sheets를 실행하세요."}</span>
            </div>
          )}
          <div className="floating-tools">
            <button className={activeTool === "select" ? "active" : ""} type="button" onClick={() => setActiveTool("select")}>
              <Move size={19} />
            </button>
            <button className={activeTool === "select" ? "active" : ""} type="button" onClick={() => setActiveTool("select")}>
              <MousePointer2 size={19} />
            </button>
            <button className={activeTool === "note" ? "active" : ""} type="button" onClick={() => setActiveTool("note")}>
              <Crosshair size={19} />
            </button>
            <button className={activeTool === "section" ? "active" : ""} type="button" onClick={() => setActiveTool("section")}>
              <Box size={19} />
            </button>
            <button className={activeTool === "measure" ? "active" : ""} type="button" onClick={() => setActiveTool("measure")}>
              <Ruler size={19} />
            </button>
            <button className={activeTool === "settings" ? "active" : ""} type="button" onClick={() => setActiveTool("settings")}>
              <Settings size={19} />
            </button>
          </div>
        </main>

        <aside className="viewer-side">
          <section className="panel ref-card selected-room-card">
            <div className="room-detail-head">
              <h2>선택된 Room</h2>
              <button className="icon-button" type="button" onClick={() => setSelectedRoomId("")} aria-label="Room 선택 해제">
                <X size={18} />
              </button>
            </div>
            {selectedRoom ? (
              <>
                <h3>
                  <span className="badge blue">연동됨</span>
                  {formatRoomTitle(selectedRoom)}
                  <Star size={17} />
                </h3>
                <dl className="detail-definition">
                  <dt>표시 기준</dt>
                  <dd>{isFloorPlanMode ? "Floor Plan zone" : "Sheet overlay"}</dd>
                  <dt>층 / 영역</dt>
                  <dd>{selectedPlanRoom?.level_name ?? selectedOverlay?.room?.level_name ?? selectedPlan?.level_name ?? "-"}</dd>
                  <dt>면적</dt>
                  <dd>{selectedRoomArea !== null ? `${selectedRoomArea} m²` : "-"}</dd>
                  <dt>Room ID</dt>
                  <dd>
                    <code>{selectedRoom.bim_photo_room_id}</code>
                  </dd>
                  <dt>Revit Element</dt>
                  <dd>{getRevitElementId(selectedRoom)}</dd>
                  <dt>최근 사진</dt>
                  <dd>{photos.length}개</dd>
                </dl>
                <div className="room-action-row">
                  <a className="button" href={selectedPhotosHref}>
                    사진 업로드 <ChevronRight size={15} />
                  </a>
                  <a className="button secondary" href={selectedPhotosHref}>
                    Room 사진 보기
                  </a>
                </div>
              </>
            ) : (
              <p className="muted">{status}</p>
            )}
          </section>
          <section className="panel ref-card">
            <h2 className="section-title">연결 정보</h2>
            <dl className="detail-definition">
              <dt>{isFloorPlanMode ? "Floor Plan" : "Sheet"}</dt>
              <dd>{isFloorPlanMode ? selectedPlan?.view_name ?? "-" : selectedSheet ? `${selectedSheet.sheet_number} · ${selectedSheet.sheet_name}` : "-"}</dd>
              <dt>Room 구역</dt>
              <dd>{isFloorPlanMode ? selectedPlan?.rooms.length ?? 0 : selectedSheet?.overlays.length ?? 0}</dd>
              <dt>프로젝트</dt>
              <dd>{projects.find((project) => project.id === projectId)?.name ?? "-"}</dd>
              <dt>동기화 시각</dt>
              <dd>
                {isFloorPlanMode && selectedPlan
                  ? new Date(selectedPlan.synced_at).toLocaleString("ko-KR")
                  : selectedSheet
                    ? new Date(selectedSheet.synced_at).toLocaleString("ko-KR")
                    : "-"}
              </dd>
            </dl>
            <p className="muted">{status}</p>
          </section>
        </aside>
      </section>

      <section className="panel ref-card viewer-photo-strip">
        <div className="ref-panel-title">
          <h2>
            {selectedRoom ? formatRoomTitle(selectedRoom) : "Room"} 관련 사진 <span className="count-badge">{photos.length}</span>
          </h2>
          <a href={selectedPhotosHref}>
            모든 사진 보기 <ChevronRight size={14} />
          </a>
        </div>
        <div className="strip-photos">
          {photos.slice(0, 6).map((photo, index) => (
            <article className={index === 0 ? "strip-photo active" : "strip-photo"} key={photo.id}>
              {photo.preview_url ? <img src={photo.preview_url} alt={photo.description ?? "Room photo"} /> : <div className="photo-fallback" />}
              <strong>{photo.work_date}</strong>
              <span>
                {photo.work_surface} · {photo.trade}
              </span>
            </article>
          ))}
          {photos.length === 0 ? <p className="muted">이 Room에 등록된 사진이 없습니다.</p> : null}
          <a className="more-photo" href={selectedPhotosHref}>
            <Camera size={25} />
            더보기
          </a>
        </div>
      </section>
    </div>
  );
}

function SheetViewer({
  sheet,
  assetUrl,
  selectedRoomId,
  onSelect
}: {
  sheet: RevitSheet;
  assetUrl: string;
  selectedRoomId: string;
  onSelect: (roomId: string) => void;
}) {
  const isPdf = sheet.asset?.mime_type === "application/pdf";
  const stageStyle = sheet.width_mm && sheet.height_mm ? { aspectRatio: `${sheet.width_mm} / ${sheet.height_mm}` } : undefined;
  const selectedOverlay = sheet.overlays.find((overlay) => overlay.bim_photo_room_id === selectedRoomId);
  return (
    <div className="floor-plan sheet-plan">
      <div className="sheet-stage canvas-sheet-stage" style={stageStyle}>
        {assetUrl ? (
          isPdf ? (
            <PdfSheetCanvas assetUrl={assetUrl} label={`${sheet.sheet_number} ${sheet.sheet_name}`} />
          ) : (
            <img className="sheet-asset" src={assetUrl} alt={`${sheet.sheet_number} ${sheet.sheet_name}`} />
          )
        ) : (
          <div className="sheet-asset-empty">
            <FileText size={30} />
            <strong>{sheet.sheet_number}</strong>
            <span>Sheet PDF를 불러오는 중이거나 PDF export가 없는 Sheet입니다.</span>
          </div>
        )}
        <svg className="sheet-overlay-svg" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Room overlay">
          {sheet.overlays.map((overlay) => (
            <SheetRoomShape key={overlay.id} overlay={overlay} selected={overlay.bim_photo_room_id === selectedRoomId} onSelect={onSelect} />
          ))}
        </svg>
        <div className="sheet-room-hint">
          <MousePointer2 size={15} />
          <span>{selectedOverlay ? formatRoomTitle(selectedOverlay) : "도면 위 파란 Room 영역을 선택하세요."}</span>
        </div>
      </div>
    </div>
  );
}

function PdfSheetCanvas({ assetUrl, label }: { assetUrl: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [renderState, setRenderState] = useState<PdfRenderState>("idle");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateWidth = () => setFrameWidth(Math.max(1, Math.round(frame.clientWidth)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!assetUrl || !canvas || !frame || frameWidth <= 0) return;
    const targetCanvas = canvas;
    const targetFrame = frame;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let pdf: PDFDocumentProxy | null = null;

    async function renderPdf() {
      setRenderState("loading");
      try {
        const [pdfjs, blobResponse] = await Promise.all([loadPdfJs(), fetch(assetUrl)]);
        if (!blobResponse.ok) throw new Error(`PDF asset ${blobResponse.status}`);
        const data = await blobResponse.arrayBuffer();
        if (cancelled) return;

        const loadingTask = pdfjs.getDocument({ data });
        pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetFrame.clientWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = targetCanvas.getContext("2d");
        if (!context) throw new Error("Canvas context is unavailable.");

        targetCanvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        targetCanvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        targetCanvas.style.width = `${viewport.width}px`;
        targetCanvas.style.height = `${viewport.height}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setRenderState("ready");
      } catch {
        if (!cancelled) setRenderState("error");
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      void pdf?.destroy();
    };
  }, [assetUrl, frameWidth]);

  return (
    <div className="sheet-canvas-frame" ref={frameRef}>
      <canvas className="sheet-canvas" ref={canvasRef} aria-label={label} />
      {renderState === "loading" || renderState === "idle" ? (
        <div className="sheet-render-status">
          <FileText size={24} />
          <span>도면을 렌더링하는 중입니다.</span>
        </div>
      ) : null}
      {renderState === "error" ? (
        <div className="sheet-render-status error">
          <FileText size={24} />
          <span>PDF 도면을 캔버스로 렌더링하지 못했습니다.</span>
        </div>
      ) : null}
    </div>
  );
}

function SheetRoomShape({
  overlay,
  selected,
  onSelect
}: {
  overlay: RevitRoomOverlay;
  selected: boolean;
  onSelect: (roomId: string) => void;
}) {
  const points = overlay.normalized_polygon.map((point) => `${point.x},${point.y}`).join(" ");
  const center = getNormalizedPolygonCenter(overlay);
  const label = formatRoomTitle(overlay);
  return (
    <g className={selected ? "sheet-room-zone-group selected" : "sheet-room-zone-group"} onClick={() => onSelect(overlay.bim_photo_room_id)}>
      <polygon className={selected ? "sheet-room-zone selected" : "sheet-room-zone"} points={points} />
      <circle className="sheet-room-pin" cx={center.x} cy={center.y} r="0.008" />
      <text className="sheet-room-label" x={center.x} y={center.y - 0.012} textAnchor="middle" fontSize="0.014">
        {label}
      </text>
      <title>{label}</title>
    </g>
  );
}

function FloorPlanSvg({
  plan,
  assetUrl,
  selectedRoomId,
  onSelect
}: {
  plan: RevitFloorPlan;
  assetUrl: string;
  selectedRoomId: string;
  onSelect: (roomId: string) => void;
}) {
  const viewBox = `${plan.bounds.min_x} ${-plan.bounds.max_y} ${plan.bounds.width} ${plan.bounds.height}`;

  return (
    <div className="floor-plan real-floor-plan">
      {assetUrl ? (
        <div className="floor-plan-asset-layer">
          {plan.asset?.mime_type === "application/pdf" ? (
            <PdfSheetCanvas assetUrl={assetUrl} label={`${plan.level_name} ${plan.view_name}`} />
          ) : (
            <img className="sheet-asset" src={assetUrl} alt={`${plan.level_name} ${plan.view_name}`} />
          )}
        </div>
      ) : null}
      <svg className="floor-plan-svg" viewBox={viewBox} role="img" aria-label={`${plan.view_name} Revit floor plan`}>
        <g className="plan-grid">
          {Array.from({ length: 12 }).map((_, index) => (
            <line
              key={`v-${index}`}
              x1={plan.bounds.min_x + (plan.bounds.width / 11) * index}
              y1={-plan.bounds.max_y}
              x2={plan.bounds.min_x + (plan.bounds.width / 11) * index}
              y2={-plan.bounds.min_y}
            />
          ))}
          {Array.from({ length: 8 }).map((_, index) => (
            <line
              key={`h-${index}`}
              x1={plan.bounds.min_x}
              y1={-plan.bounds.max_y + (plan.bounds.height / 7) * index}
              x2={plan.bounds.max_x}
              y2={-plan.bounds.max_y + (plan.bounds.height / 7) * index}
            />
          ))}
        </g>
        {plan.rooms.map((room) => (
          <PlanRoomShape key={room.bim_photo_room_id} room={room} selected={room.bim_photo_room_id === selectedRoomId} onSelect={onSelect} />
        ))}
      </svg>
    </div>
  );
}

function PlanRoomShape({ room, selected, onSelect }: { room: FloorPlanRoom; selected: boolean; onSelect: (roomId: string) => void }) {
  const points = room.polygon.map((point) => `${point.x},${-point.y}`).join(" ");
  return (
    <g className={selected ? "revit-room-shape selected" : "revit-room-shape"} onClick={() => onSelect(room.bim_photo_room_id)}>
      <polygon points={points} />
      <circle cx={room.center.x} cy={-room.center.y} r="0.45" />
      <text x={room.center.x} y={-room.center.y - 0.55} textAnchor="middle">
        {room.room_number ?? ""}
      </text>
      <text x={room.center.x} y={-room.center.y + 0.35} textAnchor="middle" className="room-name">
        {room.room_name}
      </text>
    </g>
  );
}

function getRoomDatabaseId(room: FloorPlanRoom | RevitRoomOverlay | undefined) {
  if (!room) return "";
  if (room.room_id) return room.room_id;
  if ("room" in room && room.room?.id) return room.room.id;
  return "";
}

function getRevitElementId(room: FloorPlanRoom | RevitRoomOverlay) {
  if ("revit_element_id" in room) return room.revit_element_id;
  return room.room?.revit_element_id ?? "-";
}

function getNormalizedPolygonCenter(overlay: RevitRoomOverlay) {
  if (overlay.normalized_polygon.length === 0) return { x: 0.5, y: 0.5 };
  const total = overlay.normalized_polygon.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / overlay.normalized_polygon.length,
    y: total.y / overlay.normalized_polygon.length
  };
}

function formatRoomTitle(room: FloorPlanRoom | RevitRoomOverlay) {
  if ("room_name" in room) return `${room.room_number ?? ""} ${room.room_name}`.trim();
  if (room.room) return `${room.room.room_number ?? ""} ${room.room.room_name}`.trim();
  return formatBimRoomFallback(room.bim_photo_room_id);
}

function formatBimRoomFallback(bimPhotoRoomId: string) {
  const id = bimPhotoRoomId.startsWith("rm_") ? bimPhotoRoomId.slice(3) : bimPhotoRoomId;
  return `Room ${id.slice(0, 8)}`;
}
