"use client";

import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  KeyRound,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, isUpperManager, Project, readProjectId, readSession, Room, saveProjectId, User } from "../client";

type ProjectList = { data: Project[] };
type RoomList = { data: Room[] };

export default function RoomsPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
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

  async function loadRooms(nextToken = token, nextProjectId = projectId, nextQuery = query) {
    if (!nextProjectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    const params = nextQuery ? `?q=${encodeURIComponent(nextQuery)}` : "";
    const json = await apiJson<RoomList>(`/projects/${nextProjectId}/rooms${params}`, {
      headers: authHeaders(nextToken)
    });
    setRooms(json.data);
    setPage(1);
    setSelectedRoomId((current) => (json.data.some((room) => room.id === current) ? current : json.data[0]?.id ?? ""));
    setStatus(`${json.data.length}개 Room을 불러왔습니다.`);
  }

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    saveProjectId(nextProjectId);
    setSelectedRoomId("");
    void loadRooms(token, nextProjectId).catch((err) => setStatus(err.message));
  }

  function resetSearch() {
    setQuery("");
    void loadRooms(token, projectId, "").catch((err) => setStatus(err.message));
  }

  function exportRoomsCsv() {
    const header = ["room_number", "room_name", "level_name", "bim_photo_room_id", "revit_element_id"];
    const rows = rooms.map((room) =>
      [room.room_number ?? "", room.room_name, room.level_name ?? "", room.bim_photo_room_id, room.revit_element_id ?? ""]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedProject?.code ?? "rooms"}-rooms.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rooms.length / pageSize));
  const visibleRooms = useMemo(() => rooms.slice((page - 1) * pageSize, page * pageSize), [page, rooms]);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? visibleRooms[0] ?? rooms[0];
  const selectedProject = projects.find((project) => project.id === projectId);
  const canManageBim = isUpperManager(user);
  const selectedPhotosHref = selectedRoom ? `/photos?project_id=${projectId}&room_id=${selectedRoom.id}` : "/photos";
  const mappedRooms = rooms.filter((room) => room.bim_photo_room_id).length;
  const roomSummary = [
    ["전체 Room", String(rooms.length), "조회됨", "blue"],
    ["BIM ID 연결", String(mappedRooms), `${rooms.length ? Math.round((mappedRooms / rooms.length) * 100) : 0}%`, "green"],
    ["현재 표시", String(visibleRooms.length), `${page} / ${pageCount}`, "orange"],
    ["선택 Room", selectedRoom?.room_number ?? "-", selectedRoom?.level_name ?? "-", "red"]
  ];

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
          <p className="muted">프로젝트의 Rooms를 확인하고 사진/도면 흐름으로 이동합니다.</p>
        </div>
        <div className="header-actions">
          <button className="filter-button" type="button" onClick={exportRoomsCsv} disabled={rooms.length === 0}>
            <Download size={16} />
            내보내기
          </button>
          <button className="filter-button" type="button" onClick={() => loadRooms().catch((err) => setStatus(err.message))}>
            <RefreshCw size={16} />
            새로고침
          </button>
          <a className="button secondary" href="/viewer">
            Floor Plan
          </a>
        </div>
      </header>

      {canManageBim ? (
        <section className="permission-banner">
          <Building2 size={18} />
          <span>Room 동기화는 Revit Add-in의 BIM Photo Sync 탭에서 Connect 후 Sync Rooms로 실행합니다. 웹은 동기화된 Room과 도면을 즉시 조회합니다.</span>
        </section>
      ) : null}

      <section className="filter-row rooms-filter-row">
        <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Room 이름 / 번호 / 층 검색" />
        </label>
        <button className="filter-button" type="button" onClick={() => loadRooms().catch((err) => setStatus(err.message))}>
          <Filter size={16} /> 필터
        </button>
        <button className="filter-button" type="button" onClick={resetSearch}>
          전체보기
        </button>
      </section>

      <section className="rooms-layout">
        <article className="panel ref-card room-table-card">
          <h2 className="section-title">전체 {rooms.length}개 Rooms</h2>
          <div className="status-summary-grid">
            {roomSummary.map(([label, value, percent, tone]) => (
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
                  <th>선택</th>
                  <th>Room 번호</th>
                  <th>Room 이름</th>
                  <th>층</th>
                  <th>공정 진행률</th>
                  <th>상태</th>
                  <th>최근 사진</th>
                  <th>BIM_PHOTO_ROOM_ID</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {visibleRooms.map((room, index) => {
                  const progress = Math.max(12, 86 - ((page - 1) * pageSize + index) * 7);
                  const done = progress >= 95;
                  return (
                    <tr key={room.id} className={room.id === selectedRoom?.id ? "selected" : ""} onClick={() => setSelectedRoomId(room.id)}>
                      <td><input type="checkbox" aria-label={`${room.room_name} 선택`} checked={room.id === selectedRoom?.id} readOnly /></td>
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
                      <td><code>{room.bim_photo_room_id}</code></td>
                      <td><a href={`/photos?project_id=${projectId}&room_id=${room.id}`}>사진</a></td>
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
            <span className="muted">페이지 {page} / {pageCount}</span>
            <div>
              <button className="icon-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /></button>
              {Array.from({ length: Math.min(5, pageCount) }, (_, index) => index + 1).map((pageNumber) => (
                <button key={pageNumber} className={page === pageNumber ? "page-pill active" : "page-pill"} type="button" onClick={() => setPage(pageNumber)}>
                  {pageNumber}
                </button>
              ))}
              <button className="icon-button" type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={15} /></button>
            </div>
          </div>
        </article>

        <aside className="panel ref-card room-detail-panel">
          <div className="room-detail-head">
            <div>
              <h2>{selectedRoom ? `${selectedRoom.room_number ?? ""} ${selectedRoom.room_name}` : "Room 선택"}</h2>
              <span className="badge blue">연동됨</span>
            </div>
            <button className="icon-button" type="button" onClick={() => setSelectedRoomId("")} aria-label="Room 선택 해제"><X size={18} /></button>
          </div>
          <div className="tab-row">
            <button className="active" type="button">개요</button>
            <a href={selectedPhotosHref}>사진</a>
            <a href="/viewer">Floor Plan</a>
          </div>
          <div className="mini-plan">
            <div className="plan-room selected"><span /></div>
            <div className="plan-room" />
            <div className="plan-marker" />
          </div>
          <dl className="detail-definition">
            <dt>층</dt><dd>{selectedRoom?.level_name ?? "-"}</dd>
            <dt>Room 번호</dt><dd>{selectedRoom?.room_number ?? "-"}</dd>
            <dt>Room 이름</dt><dd>{selectedRoom?.room_name ?? "-"}</dd>
            <dt>Revit Element</dt><dd>{selectedRoom?.revit_element_id ?? "-"}</dd>
            <dt>BIM_PHOTO_ROOM_ID</dt><dd><code>{selectedRoom?.bim_photo_room_id ?? "-"}</code></dd>
          </dl>
          <div className="room-actions">
            <a className="filter-button" href={selectedPhotosHref}>사진 보기</a>
            <a className="button" href="/viewer">Floor Plan에서 보기</a>
          </div>
          <p className="muted">{selectedProject?.name ?? "프로젝트"} / {status}</p>
        </aside>
      </section>
    </div>
  );
}
