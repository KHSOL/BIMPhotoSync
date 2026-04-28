"use client";

import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  KeyRound,
  MoreHorizontal,
  Plus,
  Search,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, isUpperManager, Project, readProjectId, readSession, Room, saveProjectId, User } from "../client";

type ProjectList = { data: Project[] };
type RoomList = { data: Room[] };

const statusSummary = [
  ["진행중", "162", "65%", "blue"],
  ["완료", "78", "31%", "green"],
  ["검토중", "5", "2%", "orange"],
  ["이슈", "8", "2%", "red"]
];

export default function RoomsPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Revit Add-in에서 Sync Rooms를 실행하면 Room 매핑이 표시됩니다.");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    setUser(session.user);
    const storedProjectId = readProjectId();
    setProjectId(storedProjectId);
    void loadProjects(session.token, storedProjectId).catch((err) => setStatus(err.message));
  }, []);

  async function loadProjects(nextToken = token, preferredProjectId = projectId) {
    if (!nextToken) return;
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const nextProjectId = json.data.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadRooms(nextToken, nextProjectId);
    }
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    const json = await apiJson<RoomList>(`/projects/${nextProjectId}/rooms${params}`, {
      headers: authHeaders(nextToken)
    });
    setRooms(json.data);
    setStatus(`${json.data.length}개 Room을 불러왔습니다.`);
  }

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    saveProjectId(nextProjectId);
    void loadRooms(token, nextProjectId).catch((err) => setStatus(err.message));
  }

  const visibleRooms = useMemo(() => rooms.slice(0, 10), [rooms]);
  const selectedRoom = visibleRooms[0] ?? rooms[0];
  const selectedProject = projects.find((project) => project.id === projectId);
  const canManageBim = isUpperManager(user);

  if (!token) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">Room 매핑은 회사/프로젝트 권한 안에서만 조회됩니다.</p>
        <a className="button" href="/login">
          로그인으로 이동
        </a>
      </section>
    );
  }

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">Rooms</h1>
          <p className="muted">프로젝트의 Rooms를 확인하고 관리하세요.</p>
        </div>
        <div className="header-actions">
          <button className="filter-button" type="button">
            <Download size={16} />
            내보내기
          </button>
          <button className="button" type="button" disabled={!canManageBim} title={canManageBim ? "Revit Add-in에서 실행됩니다." : "상위 관리자만 가능합니다."}>
            <Plus size={16} /> Room 동기화
          </button>
        </div>
      </header>

      <section className="filter-row">
        <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select className="input" defaultValue="all">
          <option value="all">전체 동</option>
          <option>A동</option>
        </select>
        <select className="input" defaultValue="all">
          <option value="all">전체 층</option>
          <option>3F</option>
          <option>2F</option>
        </select>
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Room 이름 / 번호 검색" />
        </label>
        <button className="filter-button" type="button" onClick={() => loadRooms().catch((err) => setStatus(err.message))}>
          <Filter size={16} /> 필터
        </button>
      </section>

      <section className="rooms-layout">
        <article className="panel ref-card room-table-card">
          <h2 className="section-title">전체 {rooms.length || 0}개 Rooms</h2>
          <div className="status-summary-grid">
            {statusSummary.map(([label, value, percent, tone]) => (
              <div className="status-summary-card" key={label}>
                <i className={`${tone}-dot`} />
                <span>{label}</span>
                <strong>{value}</strong>
                <small>({percent})</small>
              </div>
            ))}
          </div>

          <div className="room-table-wrap">
            <table className="room-table ref-table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="전체 선택" /></th>
                  <th>Room 번호</th>
                  <th>Room 이름</th>
                  <th>층</th>
                  <th>공정 진행률</th>
                  <th>상태</th>
                  <th>최근 사진</th>
                  <th>최근 업로드</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRooms.map((room, index) => {
                  const progress = Math.max(12, 86 - index * 7);
                  const done = progress >= 95;
                  return (
                    <tr key={room.id} className={index === 0 ? "selected" : ""}>
                      <td><input type="checkbox" aria-label={`${room.room_name} 선택`} defaultChecked={index === 0} /></td>
                      <td>{room.room_number ?? "-"}</td>
                      <td>{room.room_name}</td>
                      <td>{room.level_name ?? "-"}</td>
                      <td>
                        <div className="inline-progress">
                          <span><i style={{ "--value": `${progress}%` } as React.CSSProperties} /></span>
                          <b>{progress}%</b>
                        </div>
                      </td>
                      <td><span className={done ? "badge green" : "badge blue"}>{done ? "완료" : "진행중"}</span></td>
                      <td><div className="mini-photo"><div className="photo-fallback" /></div></td>
                      <td>2026-03-05 09:12</td>
                      <td><MoreHorizontal size={16} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rooms.length === 0 ? (
              <div className="empty">
                <div>
                  <Building2 size={28} />
                  <p>표시할 Room이 없습니다.</p>
                  <p className="muted">{status}</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="pagination-row">
            <button className="filter-button" type="button">10개씩 보기</button>
            <div>
              <button className="icon-button" type="button"><ChevronLeft size={15} /></button>
              <button className="page-pill active" type="button">1</button>
              <button className="page-pill" type="button">2</button>
              <button className="page-pill" type="button">3</button>
              <button className="icon-button" type="button"><ChevronRight size={15} /></button>
            </div>
          </div>
        </article>

        <aside className="panel ref-card room-detail-panel">
          <div className="room-detail-head">
            <div>
              <h2>{selectedRoom ? `${selectedRoom.room_number ?? ""} ${selectedRoom.room_name}` : "Room 선택"}</h2>
              <span className="badge blue">진행중</span>
            </div>
            <X size={18} />
          </div>
          <div className="tab-row">
            <button className="active" type="button">개요</button>
            <button type="button">사진 (18)</button>
            <button type="button">AI 분석 (6)</button>
            <button type="button">이력</button>
          </div>
          <div className="mini-plan">
            <div className="plan-room selected"><span /></div>
            <div className="plan-room" />
            <div className="plan-marker" />
          </div>
          <dl className="detail-definition">
            <dt>동 / 층</dt><dd>{selectedRoom?.level_name ?? "A동 / 3F"}</dd>
            <dt>면적</dt><dd>5.23 m²</dd>
            <dt>공종</dt><dd>방수</dd>
            <dt>공사면</dt><dd>바닥</dd>
            <dt>담당자</dt><dd>김작업</dd>
            <dt>공정 진행률</dt><dd><div className="inline-progress wide"><span><i style={{ "--value": "72%" } as React.CSSProperties} /></span><b>72%</b></div></dd>
            <dt>상태</dt><dd><span className="badge blue">진행중</span></dd>
            <dt>최근 업데이트</dt><dd>2026-03-05 09:12</dd>
            <dt>BIM_PHOTO_ROOM_ID</dt><dd><code>{selectedRoom?.bim_photo_room_id ?? "-"}</code></dd>
          </dl>
          <div className="room-actions">
            <button className="filter-button" type="button" disabled={!canManageBim}>상태 변경</button>
            <button className="button" type="button" disabled={!canManageBim}>Room 편집</button>
          </div>
          <p className="muted">{selectedProject?.name ?? "프로젝트"} / {status}</p>
        </aside>
      </section>
    </div>
  );
}
