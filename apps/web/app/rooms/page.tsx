"use client";

import { Building2, ChevronRight, KeyRound, Search } from "lucide-react";
import { useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://bimphotosync-api-production.up.railway.app/api/v1";

type Room = {
  id: string;
  bim_photo_room_id: string;
  room_number?: string;
  room_name: string;
  level_name?: string;
  revit_unique_id?: string;
};

export default function RoomsPage() {
  const [email, setEmail] = useState("dev@bim.local");
  const [password, setPassword] = useState("password123");
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("b4e070af-eaf2-4820-b111-acc2592df50b");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState("Room 목록은 Revit 동기화 후 표시됩니다.");

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

  async function loadRooms() {
    const res = await fetch(`${API_BASE}/projects/${projectId}/rooms`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "Room 조회 실패");
    setRooms(json.data);
    setStatus(`${json.data.length}개 Room을 조회했습니다.`);
  }

  return (
    <>
      <div className="breadcrumb">
        <span>Project</span>
        <ChevronRight size={14} />
        <strong>Rooms</strong>
      </div>

      <section className="panel">
        <div className="toolbar" style={{ gridTemplateColumns: "1fr 1fr 1.5fr auto" }}>
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button secondary" onClick={() => login().catch((err) => setStatus(err.message))}>
              <KeyRound size={16} /> 연결
            </button>
            <button className="button" onClick={() => loadRooms().catch((err) => setStatus(err.message))}>
              <Search size={16} /> 조회
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h1 className="panel-title">Room Mapping</h1>
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
              <p>아직 표시할 Room이 없습니다.</p>
              <p className="muted">Revit Add-in에서 Sync Rooms를 실행하면 이 표에 매핑이 표시됩니다.</p>
            </div>
          </div>
        ) : (
          <table className="room-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>Room</th>
                <th>BIM_PHOTO_ROOM_ID</th>
                <th>Revit Unique ID</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id}>
                  <td>{room.level_name ?? "-"}</td>
                  <td>
                    <strong>
                      {room.room_number ?? ""} {room.room_name}
                    </strong>
                  </td>
                  <td>{room.bim_photo_room_id}</td>
                  <td>{room.revit_unique_id ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
