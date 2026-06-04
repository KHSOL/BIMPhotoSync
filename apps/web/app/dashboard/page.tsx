"use client";

import { AlertCircle, Building2, Camera, CheckCircle2, FileText, Home, KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, canAccessAdminBoards, clearProjectId, readProjectId, readSession, saveProjectId, type User } from "../client";
import { defaultSurfaceOptions, defaultTradeOptions, labelForOption } from "../photo-options";

type DashboardProject = {
  id: string;
  name: string;
  code: string;
};

type DashboardSummary = {
  data: {
    projects: DashboardProject[];
    selected_project_id: string | null;
    totals: {
      rooms: number;
      photos: number;
      analyzed_photos: number;
      reports: number;
      revit_models: number;
      completed_photos: number;
      issue_photos: number;
      in_progress_photos: number;
      pending_photos: number;
    };
    trade_distribution: Array<{ trade: string; count: number }>;
    level_distribution: Array<{ level_name: string; count: number }>;
    recent_photos: Array<{
      id: string;
      room_name: string;
      room_number: string | null;
      level_name: string | null;
      trade: string;
      work_surface: string;
      work_date: string;
      uploaded_by: string;
    }>;
    recent_reports: Array<{
      id: string;
      title: string;
      status: string;
      created_at: string;
      created_by: string;
    }>;
  };
};

export default function DashboardPage() {
  const [token, setToken] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [summary, setSummary] = useState<DashboardSummary["data"] | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setUser(session.user);
    const storedProjectId = readProjectId();
    setToken(session.token);
    setSelectedProjectId(storedProjectId);
    void loadSummary(session.token, storedProjectId).catch((error) => handleSummaryError(error, session.token, storedProjectId));
  }, []);

  async function loadSummary(nextToken = token, projectId = selectedProjectId) {
    if (!nextToken) return;
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    const json = await apiJson<DashboardSummary>(`/dashboard/summary${query}`, { headers: authHeaders(nextToken) });
    setSummary(json.data);
  }

  async function handleSummaryError(error: unknown, nextToken = token, attemptedProjectId = selectedProjectId) {
    const message = error instanceof Error ? error.message : "현황 조회 실패";
    if (attemptedProjectId && message.includes("No project access")) {
      clearProjectId();
      setSelectedProjectId("");
      await loadSummary(nextToken, "");
      return;
    }
    setSummary(emptySummary);
  }

  function changeProject(projectId: string) {
    setSelectedProjectId(projectId);
    if (projectId) saveProjectId(projectId);
    void loadSummary(token, projectId).catch((error) => handleSummaryError(error, token, projectId));
  }

  const selectedProjectName = useMemo(() => {
    if (!summary || !selectedProjectId) return "전체 프로젝트";
    return summary.projects.find((project) => project.id === selectedProjectId)?.name ?? "전체 프로젝트";
  }, [selectedProjectId, summary]);
  const showAdminBoards = canAccessAdminBoards(user);

  if (!token) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">프로젝트 현황은 회사/프로젝트 권한 안에서만 조회됩니다.</p>
        <a className="button" href="/login">
          로그인으로 이동
        </a>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="panel empty-state">
        <RefreshCw className="spin" size={28} />
        <h1 className="panel-title">현황을 불러오는 중입니다</h1>
      </section>
    );
  }

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">대시보드</h1>
          <p className="muted">{selectedProjectName} 기준 현황입니다.</p>
        </div>
        <div className="header-actions">
          <label className="field compact dashboard-project-filter">
            <span className="label">프로젝트</span>
            <select className="input" value={selectedProjectId} onChange={(event) => changeProject(event.target.value)}>
              <option value="">전체 프로젝트</option>
              {summary.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className={`metric-grid dashboard-metric-grid ${showAdminBoards ? "six" : "five"}`}>
        <Metric icon={<Home />} label="방" value={summary.totals.rooms} sub="동기화된 방" tone="blue" />
        <Metric icon={<Camera />} label="사진" value={summary.totals.photos} sub="업로드 사진" tone="sky" />
        <Metric icon={<CheckCircle2 />} label="AI 분석 완료" value={summary.totals.analyzed_photos} sub="분석 내용 저장" tone="green" />
        <Metric icon={<AlertCircle />} label="이슈 사진" value={summary.totals.issue_photos} sub="차단 상태" tone="red" />
        {showAdminBoards ? <Metric icon={<FileText />} label="보고서" value={summary.totals.reports} sub="생성 보고서" tone="orange" /> : null}
        <Metric icon={<Building2 />} label="Revit 모델" value={summary.totals.revit_models} sub="연결 모델" tone="purple" />
      </section>

      <section className="dashboard-panels">
        <article className="panel ref-card">
          <PanelTitle title="공종별 사진 분포" href="/photos" />
          <div className="trade-progress-list">
            {summary.trade_distribution.length > 0 ? (
              summary.trade_distribution.map((row) => <DistributionRow key={row.trade} label={labelForOption(defaultTradeOptions, row.trade)} count={row.count} total={summary.totals.photos} />)
            ) : (
              <p className="muted">아직 업로드된 사진이 없습니다.</p>
            )}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="사진 처리 상태" />
          <div className="donut-card">
            <div className="donut big">
              <strong>{summary.totals.photos}</strong>
              <span>전체</span>
            </div>
            <ul className="legend-list">
              <li><i className="blue-dot" />진행중 <strong>{summary.totals.in_progress_photos}</strong></li>
              <li><i className="green-dot" />완료 <strong>{summary.totals.completed_photos}</strong></li>
              <li><i className="orange-dot" />검토대기 <strong>{summary.totals.pending_photos}</strong></li>
              <li><i className="red-dot" />이슈 <strong>{summary.totals.issue_photos}</strong></li>
            </ul>
          </div>
        </article>
      </section>

      <section className="dashboard-panels bottom">
        <article className="panel ref-card">
          <PanelTitle title="최근 업로드 사진" href="/photos" />
          <div className="recent-photo-list">
            {summary.recent_photos.map((photo) => (
              <a className="recent-photo-row" href="/photos" key={photo.id}>
                <div className="photo-thumb"><div className="photo-fallback" /></div>
                <div>
                  <strong>{photo.room_number ? `${photo.room_number} ` : ""}{photo.room_name}</strong>
                  <span>{labelForOption(defaultTradeOptions, photo.trade)} / {labelForOption(defaultSurfaceOptions, photo.work_surface)} / {photo.uploaded_by}</span>
                </div>
                <time>{photo.work_date}</time>
              </a>
            ))}
            {summary.recent_photos.length === 0 ? <p className="muted">최근 업로드가 없습니다.</p> : null}
          </div>
        </article>

        {showAdminBoards ? <article className="panel ref-card">
          <PanelTitle title="최근 보고서" href="/reports" />
          <div className="report-list">
            {summary.recent_reports.map((report) => (
              <a className="report-row" href="/reports" key={report.id}>
                <FileText size={20} />
                <div>
                  <strong>{report.title}</strong>
                  <span>{new Date(report.created_at).toLocaleString()} / {report.created_by}</span>
                </div>
                <span className="badge green">{report.status === "GENERATED" ? "생성 완료" : report.status}</span>
              </a>
            ))}
            {summary.recent_reports.length === 0 ? <p className="muted">생성된 보고서가 없습니다.</p> : null}
          </div>
        </article> : null}

        <article className="panel ref-card">
          <PanelTitle title="프로젝트 연결" />
          <div className="issue-box">
            <strong>{summary.projects.length.toLocaleString()}개</strong>
            <span>연결된 프로젝트</span>
          </div>
        </article>
      </section>
    </div>
  );
}

const emptySummary: DashboardSummary["data"] = {
  projects: [],
  selected_project_id: null,
  totals: {
    rooms: 0,
    photos: 0,
    analyzed_photos: 0,
    reports: 0,
    revit_models: 0,
    completed_photos: 0,
    issue_photos: 0,
    in_progress_photos: 0,
    pending_photos: 0
  },
  trade_distribution: [],
  level_distribution: [],
  recent_photos: [],
  recent_reports: []
};

function Metric({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub: string; tone: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value.toLocaleString()}</strong>
        <em>{sub}</em>
      </div>
    </article>
  );
}

function PanelTitle({ title, href }: { title: string; href?: string }) {
  return (
    <div className="ref-panel-title">
      <h2>{title}</h2>
      {href ? <a href={href}>전체 보기</a> : null}
    </div>
  );
}

function DistributionRow({ label, count, total }: { label: string; count: number; total: number }) {
  const percent = percentOf(count, total);
  return (
    <div className="trade-progress">
      <span>{label}</span>
      <div className="progress">
        <span style={{ "--value": `${percent}%` } as React.CSSProperties} />
      </div>
      <strong>{percent}%</strong>
      <small>{count}</small>
    </div>
  );
}

function percentOf(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}
