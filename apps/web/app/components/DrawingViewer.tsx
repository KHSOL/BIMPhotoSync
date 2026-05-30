"use client";

import {
  Camera,
  ChevronRight,
  FileText,
  Filter,
  KeyRound,
  Layers,
  MousePointer2,
  Search,
  Star,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  apiJson,
  authHeaders,
  FloorPlanRoom,
  PlanBounds,
  Photo,
  Project,
  readProjectId,
  readSession,
  RevitFloorPlan,
  RevitRoomOverlay,
  RevitSheet,
  Room,
  saveProjectId
} from "../client";
import { defaultSurfaceOptions, defaultTradeOptions, labelForOption } from "../photo-options";
import { FloorPlan3D } from "./FloorPlan3D";

type DrawingViewerMode = "floorPlans" | "sheets";
type ProjectList = { data: Project[] };
type FloorPlanList = { data: RevitFloorPlan[] };
type SheetList = { data: RevitSheet[] };
type RoomList = { data: Room[] };
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
  const [floorPlanViewMode, setFloorPlanViewMode] = useState<"2d" | "3d">("2d");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [treeQuery, setTreeQuery] = useState("");
  const [roomProgressByBimId, setRoomProgressByBimId] = useState<Record<string, Room["progress_by_surface"]>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState(
    mode === "floorPlans"
      ? "동기화된 평면도 구역을 불러오는 중입니다."
      : "동기화된 시트와 방 구역을 불러오는 중입니다."
  );

  const isFloorPlanMode = mode === "floorPlans";
  const pageTitle = isFloorPlanMode ? "평면도" : "시트";
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
    const nextProjects = Array.isArray(json.data) ? json.data : [];
    setProjects(nextProjects);
    const storedProjectId = readProjectId();
    const nextProjectId = nextProjects.some((project) => project.id === storedProjectId) ? storedProjectId : nextProjects[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadProjectGeometry(nextToken, nextProjectId);
    }
  }

  async function loadProjectGeometry(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const [floorPlanJson, sheetJson, roomJson] = await Promise.all([
      apiJson<FloorPlanList>(`/revit/projects/${nextProjectId}/floor-plans`, { headers: authHeaders(nextToken) }),
      apiJson<SheetList>(`/revit/projects/${nextProjectId}/sheets`, { headers: authHeaders(nextToken) }),
      apiJson<RoomList>(`/projects/${nextProjectId}/rooms`, { headers: authHeaders(nextToken) })
    ]);

    const nextPlans = Array.isArray(floorPlanJson.data) ? floorPlanJson.data : [];
    const nextSheets = Array.isArray(sheetJson.data) ? sheetJson.data : [];
    const nextRooms = Array.isArray(roomJson.data) ? roomJson.data : [];
    setPlans(nextPlans);
    setSheets(nextSheets);
    setRoomProgressByBimId(
      nextRooms.reduce<Record<string, Room["progress_by_surface"]>>((result, room) => {
        result[room.bim_photo_room_id] = room.progress_by_surface;
        return result;
      }, {})
    );
    setPlanId(nextPlans[0]?.id ?? "");
    setSheetId(nextSheets[0]?.id ?? "");
    setSelectedRoomId(
      isFloorPlanMode
        ? nextPlans[0]?.rooms[0]?.bim_photo_room_id ?? ""
        : nextSheets[0]?.overlays[0]?.bim_photo_room_id ?? ""
    );

    if (isFloorPlanMode) {
      const roomCount = nextPlans.reduce((sum, plan) => sum + plan.rooms.length, 0);
      setStatus(
        nextPlans.length > 0
          ? `${nextPlans.length}개 평면도와 ${roomCount}개 방 구역을 불러왔습니다.`
          : "동기화된 평면도가 없습니다."
      );
      return;
    }

    setStatus(
      nextSheets.length > 0
        ? `${nextSheets.length}개 시트와 ${nextSheets.reduce((sum, sheet) => sum + sheet.overlays.length, 0)}개 방 구역을 불러왔습니다.`
        : "동기화된 Revit 시트가 없습니다."
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
            <span className="label">평면도</span>
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
            <span className="label">시트</span>
            <select className="input" value={selectedSheet?.id ?? ""} onChange={(event) => selectSheet(event.target.value)}>
              {sheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.sheet_number} · {sheet.sheet_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="filter-button" type="button" onClick={() => loadProjectGeometry().catch((err: Error) => setStatus(err.message))}>
          <Filter size={16} />
          새로고침
        </button>
        {isFloorPlanMode ? (
          <div className="segmented-control" aria-label="도면 보기 방식">
            <button className={floorPlanViewMode === "2d" ? "active" : ""} type="button" onClick={() => setFloorPlanViewMode("2d")}>
              2D
            </button>
            <button className={floorPlanViewMode === "3d" ? "active" : ""} type="button" onClick={() => setFloorPlanViewMode("3d")}>
              3D
            </button>
          </div>
        ) : null}
      </section>

      <section className="viewer-layout">
        <aside className="panel viewer-tree">
          <h2 className="section-title">{isFloorPlanMode ? "평면도 목록" : "시트 목록"}</h2>
          <label className="search-box">
            <Search size={16} />
            <input
              value={treeQuery}
              onChange={(event) => setTreeQuery(event.target.value)}
              placeholder={isFloorPlanMode ? "평면도 검색" : "시트 검색"}
            />
          </label>
          {isFloorPlanMode ? (
            <div className="tree-group">
              <strong>
                <Layers size={16} /> Revit 평면도
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
                <FileText size={16} /> Revit 시트
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
          {isFloorPlanMode && selectedPlan && floorPlanViewMode === "3d" ? (
            <FloorPlan3D
              plan={selectedPlan}
              selectedRoomId={selectedRoomId}
              roomProgressByBimId={roomProgressByBimId}
              onSelect={setSelectedRoomId}
            />
          ) : isFloorPlanMode && selectedPlan ? (
            <FloorPlanSvg
              plan={selectedPlan}
              assetUrl={floorPlanAssetUrl}
              selectedRoomId={selectedRoomId}
              roomProgressByBimId={roomProgressByBimId}
              onSelect={setSelectedRoomId}
            />
          ) : !isFloorPlanMode && selectedSheet ? (
            <SheetViewer
              sheet={selectedSheet}
              assetUrl={sheetAssetUrl}
              selectedRoomId={selectedRoomId}
              roomProgressByBimId={roomProgressByBimId}
              onSelect={setSelectedRoomId}
            />
          ) : (
            <div className="floor-plan real-plan-empty">
              <KeyRound size={30} />
              <strong>{isFloorPlanMode ? "동기화된 평면도가 없습니다" : "동기화된 Revit 시트가 없습니다"}</strong>
              <span>{isFloorPlanMode ? "Revit에서 평면도를 동기화하세요." : "Revit에서 시트를 동기화하세요."}</span>
            </div>
          )}
        </main>

        <aside className="viewer-side">
          <section className="panel ref-card selected-room-card">
            <div className="room-detail-head">
              <h2>선택된 방</h2>
              <button className="icon-button" type="button" onClick={() => setSelectedRoomId("")} aria-label="방 선택 해제">
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
                  <dd>{isFloorPlanMode ? "평면도 구역" : "시트 오버레이"}</dd>
                  <dt>층 / 영역</dt>
                  <dd>{selectedPlanRoom?.level_name ?? selectedOverlay?.room?.level_name ?? selectedPlan?.level_name ?? "-"}</dd>
                  <dt>면적</dt>
                  <dd>{selectedRoomArea !== null ? `${selectedRoomArea} m²` : "-"}</dd>
                  <dt>방 ID</dt>
                  <dd>
                    <code>{selectedRoom.bim_photo_room_id}</code>
                  </dd>
                  <dt>Revit 요소</dt>
                  <dd>{getRevitElementId(selectedRoom)}</dd>
                  <dt>최근 사진</dt>
                  <dd>{photos.length}개</dd>
                </dl>
                <div className="room-action-row">
                  <a className="button" href={selectedPhotosHref}>
                    사진 업로드 <ChevronRight size={15} />
                  </a>
                  <a className="button secondary" href={selectedPhotosHref}>
                    방 사진 보기
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
              <dt>{isFloorPlanMode ? "평면도" : "시트"}</dt>
              <dd>{isFloorPlanMode ? selectedPlan?.view_name ?? "-" : selectedSheet ? `${selectedSheet.sheet_number} · ${selectedSheet.sheet_name}` : "-"}</dd>
              <dt>방 구역</dt>
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
            {selectedRoom ? formatRoomTitle(selectedRoom) : "방"} 관련 사진 <span className="count-badge">{photos.length}</span>
          </h2>
          <a href={selectedPhotosHref}>
            모든 사진 보기 <ChevronRight size={14} />
          </a>
        </div>
        <div className="strip-photos">
          {photos.slice(0, 6).map((photo, index) => (
            <article className={index === 0 ? "strip-photo active" : "strip-photo"} key={photo.id}>
              {photo.preview_url ? <img src={photo.preview_url} alt={photo.description ?? "방 사진"} /> : <div className="photo-fallback" />}
              <strong>{photo.work_date}</strong>
              <span>
                {labelForOption(defaultSurfaceOptions, photo.work_surface)} · {labelForOption(defaultTradeOptions, photo.trade)}
              </span>
            </article>
          ))}
          {photos.length === 0 ? <p className="muted">이 방에 등록된 사진이 없습니다.</p> : null}
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
  roomProgressByBimId,
  onSelect
}: {
  sheet: RevitSheet;
  assetUrl: string;
  selectedRoomId: string;
  roomProgressByBimId: Record<string, Room["progress_by_surface"]>;
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
            <span>시트 PDF를 불러오는 중이거나 PDF 내보내기가 없는 시트입니다.</span>
          </div>
        )}
        <svg className="sheet-overlay-svg" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="방 오버레이">
          {sheet.overlays.map((overlay) => (
            <SheetRoomShape
              key={overlay.id}
              overlay={overlay}
              selected={overlay.bim_photo_room_id === selectedRoomId}
              progressStatus={roomDisplayProgress(roomProgressByBimId[overlay.bim_photo_room_id])}
              onSelect={onSelect}
            />
          ))}
        </svg>
        <div className="sheet-room-hint">
          <MousePointer2 size={15} />
          <span>{selectedOverlay ? formatRoomTitle(selectedOverlay) : "도면 위 파란 방 영역을 선택하세요."}</span>
        </div>
      </div>
    </div>
  );
}

function PdfSheetCanvas({ assetUrl, label }: { assetUrl: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [renderState, setRenderState] = useState<PdfRenderState>("idle");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateSize = () => {
      const width = Math.max(1, Math.round(frame.clientWidth));
      const height = Math.max(1, Math.round(frame.clientHeight));
      setFrameSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!assetUrl || !canvas || !frame || frameSize.width <= 0 || frameSize.height <= 0) return;
    const targetCanvas = canvas;

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
        const viewport = page.getViewport({ scale: 1 });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = targetCanvas.getContext("2d");
        if (!context) throw new Error("Canvas context is unavailable.");

        targetCanvas.width = Math.max(1, Math.floor(frameSize.width * pixelRatio));
        targetCanvas.height = Math.max(1, Math.floor(frameSize.height * pixelRatio));
        targetCanvas.style.width = "100%";
        targetCanvas.style.height = "100%";
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: [
            (frameSize.width / viewport.width) * pixelRatio,
            0,
            0,
            (frameSize.height / viewport.height) * pixelRatio,
            0,
            0
          ]
        });
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
  }, [assetUrl, frameSize.height, frameSize.width]);

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
  progressStatus,
  onSelect
}: {
  overlay: RevitRoomOverlay;
  selected: boolean;
  progressStatus: RoomProgressStatus;
  onSelect: (roomId: string) => void;
}) {
  const points = overlay.normalized_polygon.map((point) => `${point.x},${point.y}`).join(" ");
  const center = getNormalizedPolygonCenter(overlay);
  const label = formatRoomTitle(overlay);
  return (
    <g className={`sheet-room-zone-group progress-${progressStatus}${selected ? " selected" : ""}`} onClick={() => onSelect(overlay.bim_photo_room_id)}>
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
  roomProgressByBimId,
  onSelect
}: {
  plan: RevitFloorPlan;
  assetUrl: string;
  selectedRoomId: string;
  roomProgressByBimId: Record<string, Room["progress_by_surface"]>;
  onSelect: (roomId: string) => void;
}) {
  const viewBox = `${plan.bounds.min_x} ${-plan.bounds.max_y} ${plan.bounds.width} ${plan.bounds.height}`;
  const stageStyle = { aspectRatio: `${plan.bounds.width} / ${plan.bounds.height}` };

  return (
    <div className="floor-plan real-floor-plan">
      <div className="floor-plan-stage" style={stageStyle}>
        {assetUrl ? (
          plan.asset?.mime_type === "application/pdf" ? (
            <PdfSheetCanvas assetUrl={assetUrl} label={`${plan.level_name} ${plan.view_name}`} />
          ) : (
            <img className="sheet-asset" src={assetUrl} alt={`${plan.level_name} ${plan.view_name}`} />
          )
        ) : (
          <div className="sheet-asset-empty">
            <Layers size={30} />
            <strong>{plan.view_name}</strong>
            <span>평면도 PDF를 불러오는 중이거나 PDF 내보내기가 없는 뷰입니다.</span>
          </div>
        )}
        <svg
          className="floor-plan-svg"
          viewBox={viewBox}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${plan.view_name} Revit 평면도`}
        >
          {plan.rooms.map((room) => (
            <PlanRoomShape
              key={room.bim_photo_room_id}
              room={room}
              bounds={plan.bounds}
              selected={room.bim_photo_room_id === selectedRoomId}
              progressStatus={roomDisplayProgress(roomProgressByBimId[room.bim_photo_room_id])}
              onSelect={onSelect}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function PlanRoomShape({
  room,
  bounds,
  selected,
  progressStatus,
  onSelect
}: {
  room: FloorPlanRoom;
  bounds: PlanBounds;
  selected: boolean;
  progressStatus: RoomProgressStatus;
  onSelect: (roomId: string) => void;
}) {
  const points = room.polygon.map((point) => `${point.x},${-point.y}`).join(" ");
  const minDimension = Math.max(0.1, Math.min(bounds.width, bounds.height));
  const markerRadius = minDimension * 0.01;
  const labelGap = minDimension * 0.025;
  const numberFontSize = minDimension * 0.018;
  const nameFontSize = minDimension * 0.014;

  return (
    <g className={`revit-room-shape progress-${progressStatus}${selected ? " selected" : ""}`} onClick={() => onSelect(room.bim_photo_room_id)}>
      <polygon points={points} />
      <circle cx={room.center.x} cy={-room.center.y} r={markerRadius} />
      <text x={room.center.x} y={-room.center.y - labelGap} textAnchor="middle" fontSize={numberFontSize}>
        {room.room_number ?? ""}
      </text>
      <text x={room.center.x} y={-room.center.y + labelGap} textAnchor="middle" className="room-name" fontSize={nameFontSize}>
        {room.room_name}
      </text>
      <title>{formatRoomTitle(room)}</title>
    </g>
  );
}

type RoomProgressStatus = "not-started" | "in-progress" | "completed";

function roomDisplayProgress(progress: Room["progress_by_surface"] | undefined): RoomProgressStatus {
  const wall = progress?.WALL;
  if (wall?.status === "COMPLETED") return "completed";
  if (wall?.status === "IN_PROGRESS") return "in-progress";
  const values = Object.values(progress ?? {});
  if (values.some((item) => item.status === "COMPLETED")) return "completed";
  if (values.some((item) => item.status === "IN_PROGRESS")) return "in-progress";
  return "not-started";
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
  return `방 ${id.slice(0, 8)}`;
}
