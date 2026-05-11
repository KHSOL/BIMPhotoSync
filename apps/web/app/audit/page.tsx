"use client";

import { CalendarDays, Download, KeyRound, LockKeyhole, RotateCcw, Search, ShieldCheck, Trash2, UserPlus, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, AuditEvent, AuthEvent, authHeaders, canAccessAdminBoards, Project, ProjectMember, readProjectId, readSession, saveProjectId, type User } from "../client";

export default function AuditPage() {
  const [hasSession, setHasSession] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [authEvents, setAuthEvents] = useState<AuthEvent[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const session = readSession();
    setHasSession(!!session);
    if (!session) return;
    setUser(session.user);
    setToken(session.token);
    if (!canAccessAdminBoards(session.user)) return;
    void loadProjects(session.token).catch((error) => setStatus(error instanceof Error ? error.message : "프로젝트 감사 정보 조회 실패"));
  }, []);

  async function loadProjects(nextToken = token) {
    const json = await apiJson<{ data: Project[] }>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const stored = readProjectId();
    const nextProjectId = json.data.some((project) => project.id === stored) ? stored : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadProjectAudit(nextToken, nextProjectId);
    }
  }

  async function loadProjectAudit(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const [membersJson, auditJson, authJson] = await Promise.all([
      apiJson<{ data: ProjectMember[] }>(`/projects/${nextProjectId}/members`, { headers: authHeaders(nextToken) }),
      apiJson<{ data: AuditEvent[] }>(`/projects/${nextProjectId}/audit-events?limit=50`, { headers: authHeaders(nextToken) }),
      apiJson<{ data: AuthEvent[] }>(`/projects/${nextProjectId}/auth-events?limit=20`, { headers: authHeaders(nextToken) })
    ]);
    setMembers(membersJson.data);
    setAuditEvents(auditJson.data);
    setAuthEvents(authJson.data);
    setSelectedMemberId(membersJson.data[0]?.id ?? "");
    setStatus(`${membersJson.data.length}명의 참여자와 ${auditJson.data.length}개의 활동 로그를 불러왔습니다.`);
  }

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    saveProjectId(nextProjectId);
    void loadProjectAudit(token, nextProjectId).catch((error) => setStatus(error instanceof Error ? error.message : "프로젝트 감사 정보 조회 실패"));
  }

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? members[0];
  const filteredEvents = useMemo(() => {
    const userId = selectedMember?.user.id;
    if (!selectedMemberId || !userId) return auditEvents;
    return auditEvents.filter((event) => event.actor?.id === userId);
  }, [auditEvents, selectedMember, selectedMemberId]);

  if (!hasSession) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">시스템 활동 기록은 로그인 후 조회할 수 있습니다.</p>
        <a className="button" href="/login">로그인으로 이동</a>
      </section>
    );
  }

  if (!canAccessAdminBoards(user)) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">관리자 권한이 필요합니다</h1>
        <p className="muted">Audit 보드는 관리자 계정에서만 표시됩니다.</p>
        <a className="button" href="/dashboard">Dashboard로 이동</a>
      </section>
    );
  }

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">Audit</h1>
          <p className="muted">프로젝트 참여자, 활동 로그, 최근 로그인 이벤트를 실제 API 데이터로 조회합니다.</p>
        </div>
        <button className="filter-button" type="button"><Download size={16} />내보내기</button>
      </header>

      <section className="filter-row audit-filter-row">
        <button className="input input-button" type="button"><CalendarDays size={16} />최근 활동</button>
        <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select className="input" value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
          <option value="">전체 사용자</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.user.name}</option>)}
        </select>
        <select className="input"><option>로그인/로그아웃 제외</option></select>
        <select className="input"><option>전체 리소스</option></select>
        <label className="search-box"><Search size={17} /><input placeholder="키워드 검색" /></label>
        <button className="filter-button" type="button" onClick={() => loadProjectAudit().catch((error) => setStatus(error.message))}><RotateCcw size={16} />새로고침</button>
      </section>

      <section className="metric-grid five">
        <Metric icon={<ShieldCheck />} label="전체 활동" value={String(auditEvents.length)} sub="현재 프로젝트" tone="blue" />
        <Metric icon={<UserPlus />} label="생성" value={String(auditEvents.filter((event) => event.action === "CREATE").length)} sub="실제 로그" tone="green" />
        <Metric icon={<Wand2 />} label="수정" value={String(auditEvents.filter((event) => event.action === "UPDATE").length)} sub="실제 로그" tone="orange" />
        <Metric icon={<Trash2 />} label="삭제" value={String(auditEvents.filter((event) => event.action === "DELETE").length)} sub="실제 로그" tone="purple" />
        <Metric icon={<LockKeyhole />} label="최근 로그인" value={String(authEvents.length)} sub="auth event" tone="sky" />
      </section>

      <section className="panel ref-card">
        <div className="ref-panel-title"><h2>프로젝트 참여자</h2><span className="muted">{status}</span></div>
        <div className="member-audit-grid">
          <div className="member-list">
            {members.map((member) => (
              <button className={member.id === selectedMember?.id ? "member-row active" : "member-row"} key={member.id} type="button" onClick={() => setSelectedMemberId(member.id)}>
                <strong>{member.user.name}</strong>
                <span>{member.user.email}</span>
                <em>{member.role}</em>
              </button>
            ))}
            {members.length === 0 ? <p className="muted">현재 프로젝트 참여자가 없습니다.</p> : null}
          </div>
          <dl className="member-detail">
            <div><dt>이름</dt><dd>{selectedMember?.user.name ?? "-"}</dd></div>
            <div><dt>이메일</dt><dd>{selectedMember?.user.email ?? "-"}</dd></div>
            <div><dt>회사</dt><dd>{selectedMember?.user.company_name ?? "-"}</dd></div>
            <div><dt>전역 권한</dt><dd>{selectedMember?.user.role ?? "-"}</dd></div>
            <div><dt>프로젝트 권한</dt><dd>{selectedMember?.role ?? "-"}</dd></div>
            <div><dt>참여일</dt><dd>{selectedMember ? new Date(selectedMember.created_at).toLocaleString("ko-KR") : "-"}</dd></div>
          </dl>
        </div>
      </section>

      <section className="audit-layout">
        <article className="panel ref-card audit-table-card">
          <h2 className="section-title">활동 로그</h2>
          <div className="room-table-wrap">
            <table className="room-table ref-table">
              <thead><tr><th>시간</th><th>사용자</th><th>프로젝트</th><th>작업</th><th>리소스</th><th>상세 정보</th><th>IP 주소</th></tr></thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.created_at).toLocaleString("ko-KR")}</td>
                    <td>{event.actor?.name ?? "-"}</td>
                    <td>{event.project?.name ?? "-"}</td>
                    <td><span className={`badge ${event.action === "DELETE" ? "red" : event.action === "UPDATE" ? "blue" : "green"}`}>{event.action}</span></td>
                    <td>{event.resource_type}</td>
                    <td>{event.detail ?? event.resource_id ?? "-"}</td>
                    <td>{event.ip_address ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredEvents.length === 0 ? <div className="empty compact-empty">활동 로그가 없습니다.</div> : null}
          </div>
        </article>

        <aside className="audit-side">
          <section className="panel ref-card">
            <h2 className="section-title">작업 유형별 활동</h2>
            <div className="donut-card compact">
              <div className="donut big audit"><strong>{auditEvents.length}</strong><span>Total</span></div>
              <ul className="legend-list">
                <li><i className="green-dot" />생성 <strong>{auditEvents.filter((event) => event.action === "CREATE").length}</strong></li>
                <li><i className="blue-dot" />수정 <strong>{auditEvents.filter((event) => event.action === "UPDATE").length}</strong></li>
                <li><i className="purple-dot" />삭제 <strong>{auditEvents.filter((event) => event.action === "DELETE").length}</strong></li>
              </ul>
            </div>
          </section>
          <section className="panel ref-card">
            <div className="ref-panel-title"><h2>최근 로그인 활동</h2></div>
            <div className="login-activity-list">
              {authEvents.map((event) => (
                <div className="login-activity-row" key={event.id}>
                  <span>{event.user?.name.slice(0, 2).toUpperCase() ?? "--"}</span>
                  <strong>{event.user?.name ?? event.email}</strong>
                  <time>{new Date(event.created_at).toLocaleString("ko-KR")}</time>
                  <em className={event.success ? "success" : "fail"}>{event.success ? "성공" : "실패"}</em>
                </div>
              ))}
              {authEvents.length === 0 ? <div className="empty compact-empty">아직 로그인 이벤트가 없습니다.</div> : null}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function Metric({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: string }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
    </article>
  );
}
