"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type Room = {
  id: string;
  bim_photo_room_id: string;
  room_number?: string;
  room_name: string;
  level_name?: string;
  revit_unique_id?: string;
};

export default function RoomsPage() {
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState("Room 목록은 Revit 동기화 또는 수동 생성 후 표시됩니다.");

  async function loadRooms() {
    const res = await fetch(`${API_BASE}/projects/${projectId}/rooms`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "Room 조회 실패");
    setRooms(json.data);
    setStatus(`${json.data.length}개 Room`);
  }

  return (
    <>
      <section>
        <h1 style={{ fontSize: 24, lineHeight: "32px", margin: 0 }}>Room 관리</h1>
        <p className="muted">Room은 사진, AI 분석, Revit 매핑의 기준 객체입니다.</p>
      </section>
      <section className="panel">
        <div className="toolbar" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
          <Field label="JWT Token">
            <input className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} />
          </Field>
          <Field label="Project ID">
            <input className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
          </Field>
          <button className="button" onClick={() => loadRooms().catch((err) => setStatus(err.message))}>
            조회
          </button>
        </div>
      </section>
      <div className="panel">
        <p className="muted">{status}</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748B" }}>
              <th style={cell}>Level</th>
              <th style={cell}>Room</th>
              <th style={cell}>BIM_PHOTO_ROOM_ID</th>
              <th style={cell}>Revit Unique ID</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <td style={cell}>{room.level_name ?? "-"}</td>
                <td style={cell}>
                  {room.room_number ?? ""} {room.room_name}
                </td>
                <td style={cell}>{room.bim_photo_room_id}</td>
                <td style={cell}>{room.revit_unique_id ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

const cell = { borderBottom: "1px solid #E2E8F0", padding: "10px 8px" };

