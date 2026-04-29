"use client";

import {
  Box,
  Camera,
  ChevronRight,
  Crosshair,
  Eye,
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
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, FloorPlanRoom, Photo, Project, readProjectId, readSession, RevitFloorPlan, saveProjectId } from "../client";

type ProjectList = { data: Project[] };
type FloorPlanList = { data: RevitFloorPlan[] };
type RoomPhotosResponse = { data: { photos: Photo[] } };

export default function ViewerPage() {
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [plans, setPlans] = useState<RevitFloorPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState("Revit Add-in에서 Sync Rooms를 실행하면 실제 Room 도면이 표시됩니다.");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    void loadProjects(session.token).catch((err) => setStatus(err.message));
  }, []);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === planId) ?? plans[0], [planId, plans]);
  const levels = useMemo(() => Array.from(new Set(plans.map((plan) => plan.level_name))), [plans]);
  const selectedRoom = useMemo(
    () => selectedPlan?.rooms.find((room) => room.bim_photo_room_id === selectedRoomId) ?? selectedPlan?.rooms[0],
    [selectedPlan, selectedRoomId]
  );

  useEffect(() => {
    if (!token || !selectedRoom) return;
    setSelectedRoomId(selectedRoom.bim_photo_room_id);
    void loadRoomPhotos(selectedRoom.bim_photo_room_id).catch((err) => setStatus(err.message));
  }, [token, selectedRoom?.bim_photo_room_id]);

  async function loadProjects(nextToken = token) {
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const storedProjectId = readProjectId();
    const nextProjectId = json.data.some((project) => project.id === storedProjectId) ? storedProjectId : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadFloorPlans(nextToken, nextProjectId);
    }
  }

  async function loadFloorPlans(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<FloorPlanList>(`/revit/projects/${nextProjectId}/floor-plans`, {
      headers: authHeaders(nextToken)
    });
    setPlans(json.data);
    setPlanId(json.data[0]?.id ?? "");
    setSelectedRoomId(json.data[0]?.rooms[0]?.bim_photo_room_id ?? "");
    setStatus(json.data.length ? `${json.data[0].view_name} 도면을 불러왔습니다.` : "동기화된 Revit 도면이 없습니다.");
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
    void loadFloorPlans(token, nextProjectId).catch((err) => setStatus(err.message));
  }

  if (!token) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">도면 Viewer는 프로젝트 권한 안에서만 조회됩니다.</p>
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
        <label className="field compact">
          <span className="label">모델 / 뷰</span>
          <select className="input" value={planId} onChange={(event) => setPlanId(event.target.value)}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.view_name}
              </option>
            ))}
          </select>
        </label>
        <label className="field compact">
          <span className="label">층</span>
          <select className="input" value={selectedPlan?.level_name ?? ""} onChange={(event) => setPlanId(plans.find((plan) => plan.level_name === event.target.value)?.id ?? "")}>
            {levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <div className="tool-segment">
          <button className="active" type="button"><MousePointer2 size={17} />선택</button>
          <button type="button"><Ruler size={17} />측정</button>
          <button type="button"><Crosshair size={17} />주석</button>
          <button type="button"><Box size={17} />단면</button>
        </div>
        <div className="tool-segment small">
          <button className="active" type="button">2D</button>
          <button type="button" disabled>3D</button>
        </div>
        <button className="filter-button" type="button" onClick={() => loadFloorPlans().catch((err) => setStatus(err.message))}>
          <Filter size={16} />새로고침
        </button>
      </section>

      <section className="viewer-layout">
        <aside className="panel viewer-tree">
          <h2 className="section-title">층 / 뷰</h2>
          <label className="search-box">
            <Search size={16} />
            <input placeholder="층 이름 검색" />
          </label>
          <div className="tree-group">
            <strong><Layers size={16} /> 실제 Revit 모델</strong>
            {levels.map((level) => (
              <button className={level === selectedPlan?.level_name ? "active" : ""} key={level} type="button" onClick={() => setPlanId(plans.find((plan) => plan.level_name === level)?.id ?? "")}>
                <span>{level}</span>
                <small>{level === selectedPlan?.level_name ? <Eye size={14} /> : ""}</small>
              </button>
            ))}
          </div>
          <div className="tree-group">
            <h3>뷰 목록</h3>
            {plans.map((plan) => (
              <button className={plan.id === selectedPlan?.id ? "active" : ""} key={plan.id} type="button" onClick={() => setPlanId(plan.id)}>
                <span>{plan.view_name}</span>
                {plan.id === selectedPlan?.id ? <Eye size={14} /> : null}
              </button>
            ))}
          </div>
        </aside>

        <main className="viewer-main">
          {selectedPlan ? (
            <FloorPlanSvg plan={selectedPlan} selectedRoomId={selectedRoom?.bim_photo_room_id ?? ""} onSelect={setSelectedRoomId} />
          ) : (
            <div className="floor-plan real-plan-empty">
              <KeyRound size={30} />
              <strong>동기화된 Revit 도면이 없습니다</strong>
              <span>Revit에서 BIM Photo Sync 탭의 Connect 후 Sync Rooms를 실행하세요.</span>
            </div>
          )}
          <div className="floating-tools">
            <button type="button"><Move size={19} /></button>
            <button className="active" type="button"><MousePointer2 size={19} /></button>
            <button type="button"><Crosshair size={19} /></button>
            <button type="button"><Box size={19} /></button>
            <button type="button"><Ruler size={19} /></button>
            <button type="button"><Settings size={19} /></button>
          </div>
        </main>

        <aside className="viewer-side">
          <section className="panel ref-card selected-room-card">
            <div className="room-detail-head">
              <h2>선택된 Room</h2>
              <X size={18} />
            </div>
            {selectedRoom ? (
              <>
                <h3><span className="badge blue">연동됨</span>{selectedRoom.room_number ?? ""} {selectedRoom.room_name} <Star size={17} /></h3>
                <dl className="detail-definition">
                  <dt>층 / 영역</dt><dd>{selectedRoom.level_name ?? selectedPlan?.level_name}</dd>
                  <dt>면적</dt><dd>{selectedRoom.area_m2 ? `${selectedRoom.area_m2} m²` : "-"}</dd>
                  <dt>Room ID</dt><dd><code>{selectedRoom.bim_photo_room_id}</code></dd>
                  <dt>Revit Element</dt><dd>{selectedRoom.revit_element_id}</dd>
                  <dt>최근 사진</dt><dd>{photos.length}개</dd>
                </dl>
                <a className="button secondary" href="/photos">Room 사진 보기 <ChevronRight size={15} /></a>
              </>
            ) : (
              <p className="muted">{status}</p>
            )}
          </section>
          <section className="panel ref-card">
            <h2 className="section-title">연결 정보</h2>
            <dl className="detail-definition">
              <dt>Revit View</dt><dd>{selectedPlan?.view_name ?? "-"}</dd>
              <dt>동기화 층</dt><dd>{selectedPlan?.level_name ?? "-"}</dd>
              <dt>Room 수</dt><dd>{selectedPlan?.rooms.length ?? 0}</dd>
              <dt>동기화 시각</dt><dd>{selectedPlan ? new Date(selectedPlan.created_at).toLocaleString("ko-KR") : "-"}</dd>
            </dl>
            <p className="muted">{status}</p>
          </section>
        </aside>
      </section>

      <section className="panel ref-card viewer-photo-strip">
        <div className="ref-panel-title">
          <h2>{selectedRoom ? `${selectedRoom.room_number ?? ""} ${selectedRoom.room_name}` : "Room"} 관련 사진 <span className="count-badge">{photos.length}</span></h2>
          <a href="/photos">모든 사진 보기 <ChevronRight size={14} /></a>
        </div>
        <div className="strip-photos">
          {photos.slice(0, 6).map((photo, index) => (
            <article className={index === 0 ? "strip-photo active" : "strip-photo"} key={photo.id}>
              {photo.preview_url ? <img src={photo.preview_url} alt={photo.description ?? "Room photo"} /> : <div className="photo-fallback" />}
              <strong>{photo.work_date}</strong>
              <span>{photo.work_surface} · {photo.trade}</span>
            </article>
          ))}
          {photos.length === 0 ? <p className="muted">이 Room에 등록된 사진이 없습니다.</p> : null}
          <a className="more-photo" href="/photos"><Camera size={25} />더보기</a>
        </div>
      </section>
    </div>
  );
}

function FloorPlanSvg({
  plan,
  selectedRoomId,
  onSelect
}: {
  plan: RevitFloorPlan;
  selectedRoomId: string;
  onSelect: (roomId: string) => void;
}) {
  const viewBox = `${plan.bounds.min_x} ${-plan.bounds.max_y} ${plan.bounds.width} ${plan.bounds.height}`;

  return (
    <div className="floor-plan real-floor-plan">
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
