"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  KeyRound,
  LockKeyhole,
  MoreHorizontal,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Wand2
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiJson, authHeaders, canAccessAdminBoards, Project, ProjectMember, readProjectId, readSession, saveProjectId, type User } from "../client";

const logRows = [
  ["2026-03-07 14:30:25", "김작업 (Worker)", "A현장 신축공사", "생성", "Room 101 (욕실)", "Room 생성", "211.234.45.67"],
  ["2026-03-07 14:28:11", "이관리 (Manager)", "A현장 신축공사", "수정", "Room 101 (욕실)", "공정 상태 변경", "211.234.45.67"],
  ["2026-03-07 14:21:33", "송지원 (Worker)", "A현장 신축공사", "생성", "Photo #20260307_12", "사진 업로드", "211.234.45.89"],
  ["2026-03-07 14:19:02", "이관리 (Manager)", "A현장 신축공사", "수정", "AI 분석 #1982", "AI 결과 승인", "211.234.45.67"],
  ["2026-03-07 14:10:45", "김작업 (Worker)", "A현장 신축공사", "삭제", "Photo #20260306_09", "사진 삭제", "211.234.45.67"],
  ["2026-03-07 13:55:18", "박BIM (BIM Manager)", "A현장 신축공사", "수정", "Room 205 (거실)", "속성 정보 수정", "211.234.45.21"],
  ["2026-03-07 13:48:07", "시스템", "A현장 신축공사", "로그인", "-", "로그인 성공", "211.234.45.21"],
  ["2026-03-07 13:45:31", "시스템", "A현장 신축공사", "로그인", "-", "로그아웃", "211.234.45.21"],
  ["2026-03-07 13:30:12", "프로젝트 관리자", "A현장 신축공사", "생성", "Report #RPT-2026-031", "보고서 생성", "211.234.45.10"],
  ["2026-03-07 13:22:55", "이관리 (Manager)", "A현장 신축공사", "수정", "공종 설정 (타일)", "기준 공정률 변경", "211.234.45.67"]
];

export default function AuditPage() {
  const [hasSession, setHasSession] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const session = readSession();
    setHasSession(!!session);
    if (!session) return;
    setUser(session.user);
    setToken(session.token);
    if (!canAccessAdminBoards(session.user)) return;
    void loadProjects(session.token).catch((error) => setStatus(error instanceof Error ? error.message : "프로젝트 멤버 조회 실패"));
  }, []);

  async function loadProjects(nextToken = token) {
    const json = await apiJson<{ data: Project[] }>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const stored = readProjectId();
    const nextProjectId = json.data.some((project) => project.id === stored) ? stored : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await loadMembers(nextToken, nextProjectId);
    }
  }

  async function loadMembers(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<{ data: ProjectMember[] }>(`/projects/${nextProjectId}/members`, { headers: authHeaders(nextToken) });
    setMembers(json.data);
    setSelectedMemberId(json.data[0]?.id ?? "");
    setStatus(`${json.data.length}명의 프로젝트 참여자를 불러왔습니다.`);
  }

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    saveProjectId(nextProjectId);
    void loadMembers(token, nextProjectId).catch((error) => setStatus(error instanceof Error ? error.message : "프로젝트 멤버 조회 실패"));
  }

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

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? members[0];
  const visibleLogRows = logRows.filter(([, , , action]) => action !== "로그인");

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">Audit</h1>
          <p className="muted">시스템 내 모든 활동 기록을 조회하고 추적할 수 있습니다.</p>
        </div>
        <button className="filter-button" type="button"><Download size={16} />내보내기</button>
      </header>

      <section className="filter-row audit-filter-row">
        <button className="input input-button" type="button"><CalendarDays size={16} />2026-03-01 ~ 2026-03-07</button>
        <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select className="input" value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
          <option value="">전체 사용자</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.user.name}</option>)}
        </select>
        <select className="input"><option>전체 작업</option></select>
        <select className="input"><option>전체 리소스</option></select>
        <label className="search-box">
          <Search size={17} />
          <input placeholder="키워드 검색 (리소스명, IP 등)" />
        </label>
        <button className="filter-button" type="button"><RotateCcw size={16} />필터 초기화</button>
      </section>

      <section className="metric-grid five">
        <Metric icon={<ShieldCheck />} label="전체 활동" value="1,248" sub="▲ 18.6% (지난 7일 대비)" tone="blue" />
        <Metric icon={<UserPlus />} label="생성" value="342" sub="▲ 12.4%" tone="green" />
        <Metric icon={<Wand2 />} label="수정" value="512" sub="▲ 22.7%" tone="orange" />
        <Metric icon={<Trash2 />} label="삭제" value="83" sub="▼ 5.6%" tone="purple" />
        <Metric icon={<LockKeyhole />} label="조회" value="311" sub="▲ 8.3%" tone="sky" />
      </section>

      <section className="panel ref-card">
        <div className="ref-panel-title">
          <h2>프로젝트 참여자</h2>
          <span className="muted">{status}</span>
        </div>
        <div className="member-audit-grid">
          <div className="member-list">
            {members.map((member) => (
              <button
                className={member.id === selectedMember?.id ? "member-row active" : "member-row"}
                key={member.id}
                type="button"
                onClick={() => setSelectedMemberId(member.id)}
              >
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
              <thead>
                <tr>
                  <th>시간</th>
                  <th>사용자</th>
                  <th>프로젝트</th>
                  <th>작업</th>
                  <th>리소스</th>
                  <th>상세 정보</th>
                  <th>IP 주소</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleLogRows.map(([time, user, project, action, resource, detail, ip]) => (
                  <tr key={`${time}-${resource}`}>
                    <td>{time}</td>
                    <td>{user}</td>
                    <td>{project}</td>
                    <td><span className={`badge ${action === "삭제" ? "red" : action === "수정" ? "blue" : action === "로그인" ? "sky" : "green"}`}>{action}</span></td>
                    <td>{resource}</td>
                    <td>{detail}</td>
                    <td>{ip}</td>
                    <td><MoreHorizontal size={16} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-row">
            <button className="filter-button" type="button">10개씩 보기</button>
            <div>
              <button className="icon-button" type="button"><ChevronLeft size={15} /></button>
              <button className="page-pill active" type="button">1</button>
              <button className="page-pill" type="button">2</button>
              <button className="page-pill" type="button">3</button>
              <button className="page-pill" type="button">4</button>
              <button className="icon-button" type="button"><ChevronRight size={15} /></button>
            </div>
          </div>
        </article>

        <aside className="audit-side">
          <section className="panel ref-card">
            <h2 className="section-title">작업 유형별 활동</h2>
            <div className="donut-card compact">
              <div className="donut big audit">
                <strong>1,248</strong>
                <span>Total</span>
              </div>
              <ul className="legend-list">
                <li><i className="green-dot" />생성 <strong>342 (27%)</strong></li>
                <li><i className="blue-dot" />수정 <strong>512 (41%)</strong></li>
                <li><i className="purple-dot" />삭제 <strong>83 (7%)</strong></li>
                <li><i className="orange-dot" />조회 <strong>209 (17%)</strong></li>
              </ul>
            </div>
          </section>
          <section className="panel ref-card">
            <h2 className="section-title">시간대별 활동 (최근 7일)</h2>
            <div className="line-chart">
              <span style={{ "--x": "5%", "--y": "60%" } as React.CSSProperties} />
              <span style={{ "--x": "20%", "--y": "24%" } as React.CSSProperties} />
              <span style={{ "--x": "35%", "--y": "48%" } as React.CSSProperties} />
              <span style={{ "--x": "50%", "--y": "42%" } as React.CSSProperties} />
              <span style={{ "--x": "65%", "--y": "36%" } as React.CSSProperties} />
              <span style={{ "--x": "82%", "--y": "67%" } as React.CSSProperties} />
              <span style={{ "--x": "96%", "--y": "46%" } as React.CSSProperties} />
            </div>
          </section>
          <section className="panel ref-card">
            <div className="ref-panel-title">
              <h2>최근 로그인 활동</h2>
            </div>
            <div className="empty compact-empty">
              <div>
                <LockKeyhole size={24} />
                <p>로그인 이력은 아직 실제 이벤트 저장소와 연결되지 않았습니다.</p>
                <p className="muted">샘플 날짜는 제거했으며, 추후 auth event 테이블을 추가하면 이 영역에 실제 이력을 표시합니다.</p>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
    </article>
  );
}
