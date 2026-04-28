"use client";

import { Building2, ChevronRight, KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, Project, readProjectId, readSession, Room, saveProjectId } from "../client";

type ProjectList = { data: Project[] };
type RoomList = { data: Room[] };

export default function RoomsPage() {
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Revit Add-in에서 Sync Rooms를 실행하면 Room 매핑이 표시됩니다.");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    const storedProjectId = readProjectId();
    setProjectId(storedProjectId);
    void loadProjects(session.token, storedProjectId);
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

  const groupedRooms = useMemo(() => {
    return rooms.reduce<Record<string, Room[]>>((acc, room) => {
      const level = room.level_name ?? "Level 미지정";
      acc[level] = [...(acc[level] ?? []), room];
      return acc;
    }, {});
  }, [rooms]);

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
    <>
      <div className="breadcrumb">
        <span>Project</span>
        <ChevronRight size={14} />
        <strong>Rooms</strong>
      </div>

      <section className="panel">
        <div className="toolbar room-toolbar">
          <Field label="Project">
            <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} / {project.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room Search">
            <input
              className="input"
              placeholder="101, 욕실, 3F"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <button className="button" onClick={() => loadRooms().catch((err) => setStatus(err.message))} type="button">
            <RefreshCw size={16} /> 조회
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h1 className="page-title">Revit Room Mapping</h1>
            <div className="muted">{status}</div>
          </div>
          <span className="badge blue">
            <Building2 size={13} /> BIM_PHOTO_ROOM_ID
          </span>
        </div>

        {rooms.length === 0 ? (
          <div className="empty">
            <div>
              <Building2 size={28} />
              <p>표시할 Room이 없습니다.</p>
              <p className="muted">Revit Add-in의 Connect Project와 Sync Rooms 실행 후 다시 조회하세요.</p>
            </div>
          </div>
        ) : (
          <div className="room-map">
            {Object.entries(groupedRooms).map(([level, levelRooms]) => (
              <div className="level-band" key={level}>
                <div className="level-title">{level}</div>
                <div className="room-card-grid">
                  {levelRooms.map((room) => (
                    <article className="room-card" key={room.id}>
                      <strong>
                        {room.room_number ?? ""} {room.room_name}
                      </strong>
                      <span>{room.location_text ?? "Revit Room"}</span>
                      <code>{room.bim_photo_room_id}</code>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">도면 연동 상태</h2>
          <span className="badge green">Room 기준</span>
        </div>
        <p className="muted">
          1차 범위에서는 APS Viewer를 확장하지 않고, Revit에서 동기화된 Room 목록과 BIM_PHOTO_ROOM_ID를 웹/앱의 도면
          탐색 기준으로 사용합니다. 실제 Revit 선택 조회는 Add-in Dockable Panel이 같은 ID로 API를 호출합니다.
        </p>
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
