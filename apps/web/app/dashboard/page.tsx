"use client";

import { AlertCircle, BarChart3, Building2, Camera, CheckCircle2, FileText, Home, KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiJson, authHeaders, readProjectId, readSession, saveProjectId } from "../client";

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
  const [status, setStatus] = useState("");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    const storedProjectId = readProjectId();
    setToken(session.token);
    setSelectedProjectId(storedProjectId);
    void loadSummary(session.token, storedProjectId);
  }, []);

  async function loadSummary(nextToken = token, projectId = selectedProjectId) {
    if (!nextToken) return;
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    const json = await apiJson<DashboardSummary>(`/dashboard/summary${query}`, { headers: authHeaders(nextToken) });
    setSummary(json.data);
    setStatus(projectId ? "선택한 프로젝트 현황을 불러왔습니다." : "전체 프로젝트 현황을 불러왔습니다.");
  }

  function changeProject(projectId: string) {
    setSelectedProjectId(projectId);
    if (projectId) saveProjectId(projectId);
    void loadSummary(token, projectId).catch((error) => setStatus(error instanceof Error ? error.message : "현황 조회 실패"));
  }

  const selectedProjectName = useMemo(() => {
    if (!summary || !selectedProjectId) return "전체 프로젝트";
    return summary.projects.find((project) => project.id === selectedProjectId)?.name ?? "전체 프로젝트";
  }, [selectedProjectId, summary]);

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
          <h1 className="page-title">Dashboard</h1>
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
          <button className="filter-button" type="button" onClick={() => loadSummary().catch((error) => setStatus(error.message))}>
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>
      </header>

      <section className="metric-grid six">
        <Metric icon={<Home />} label="Rooms" value={summary.totals.rooms} sub="동기화된 Room" tone="blue" />
        <Metric icon={<Camera />} label="Photos" value={summary.totals.photos} sub="업로드 사진" tone="sky" />
        <Metric icon={<CheckCircle2 />} label="AI 분석 완료" value={summary.totals.analyzed_photos} sub="분석 내용 저장" tone="green" />
        <Metric icon={<AlertCircle />} label="이슈 사진" value={summary.totals.issue_photos} sub="BLOCKED 상태" tone="red" />
        <Metric icon={<FileText />} label="Reports" value={summary.totals.reports} sub="생성 보고서" tone="orange" />
        <Metric icon={<Building2 />} label="Revit Models" value={summary.totals.revit_models} sub="연결 모델" tone="purple" />
      </section>

      <section className="dashboard-panels">
        <article className="panel ref-card">
          <PanelTitle title="공종별 사진 분포" href="/photos" />
          <div className="trade-progress-list">
            {summary.trade_distribution.length > 0 ? (
              summary.trade_distribution.map((row) => <DistributionRow key={row.trade} label={row.trade} count={row.count} total={summary.totals.photos} />)
            ) : (
              <p className="muted">아직 업로드된 사진이 없습니다.</p>
            )}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="층별 Room 분포" href="/rooms" />
          <div className="bar-chart">
            {summary.level_distribution.length > 0 ? (
              summary.level_distribution.map((row) => {
                const percent = percentOf(row.count, summary.totals.rooms);
                return (
                  <div className="bar-column" key={row.level_name}>
                    <strong>{percent}%</strong>
                    <span style={{ "--value": `${percent}%` } as React.CSSProperties} />
                    <small>{row.level_name}</small>
                  </div>
                );
              })
            ) : (
              <p className="muted">아직 동기화된 Room이 없습니다.</p>
            )}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="사진 처리 상태" />
          <div className="donut-card">
            <div className="donut big">
              <strong>{summary.totals.photos}</strong>
              <span>Total</span>
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
                  <span>{photo.trade} / {photo.work_surface} / {photo.uploaded_by}</span>
                </div>
                <time>{photo.work_date}</time>
              </a>
            ))}
            {summary.recent_photos.length === 0 ? <p className="muted">최근 업로드가 없습니다.</p> : null}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="최근 보고서" href="/reports" />
          <div className="report-list">
            {summary.recent_reports.map((report) => (
              <a className="report-row" href="/reports" key={report.id}>
                <FileText size={20} />
                <div>
                  <strong>{report.title}</strong>
                  <span>{new Date(report.created_at).toLocaleString()} / {report.created_by}</span>
                </div>
                <span className="badge green">{report.status}</span>
              </a>
            ))}
            {summary.recent_reports.length === 0 ? <p className="muted">생성된 보고서가 없습니다.</p> : null}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="상태" />
          <div className="issue-box">
            <strong>{status}</strong>
            <span><BarChart3 size={16} /> 데이터 기준: API 집계</span>
            <span>프로젝트 수 <b>{summary.projects.length}</b></span>
          </div>
        </article>
      </section>
    </div>
  );
}

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
