"use client";

import { Download, Eye, FileText, KeyRound, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  API_BASE,
  apiJson,
  authHeaders,
  canAccessAdminBoards,
  GeneratedReport,
  isUpperManager,
  Project,
  readProjectId,
  readSession,
  Room,
  saveProjectId,
  TradeCategory,
  User
} from "../client";
import { defaultSurfaceOptions, defaultTradeOptions, labelForOption, legacyTradeValue } from "../photo-options";

const legacyTrades = ["", "WATERPROOF", "TILE", "PAINT", "ELECTRIC", "MEP", "WINDOW", "CONCRETE", "OTHER"];

type ProjectList = { data: Project[] };
type RoomList = { data: Room[] };
type ReportList = { data: GeneratedReport[] };
type ReportResult = { data: GeneratedReport };
type TradeCategoryList = { data: TradeCategory[] };
type ReportOwnerFilter = "ALL" | "MINE";

export default function ReportsPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tradeCategories, setTradeCategories] = useState<TradeCategory[]>([]);
  const [reports, setReports] = useState<GeneratedReport[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<ReportOwnerFilter>("ALL");
  const [status, setStatus] = useState("로그인 후 프로젝트를 선택하세요.");
  const [generating, setGenerating] = useState(false);
  const [filters, setFilters] = useState({
    room_id: "",
    work_surface: "",
    trade: "",
    trade_category_id: "",
    date_from: "",
    date_to: "",
    worker_name: "",
    title: "",
    memo: "",
    ai_prompt: ""
  });

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    setUser(session.user);
    if (!canAccessAdminBoards(session.user)) {
      setStatus("보고서 보드는 관리자 계정에서만 사용할 수 있습니다.");
      return;
    }
    void loadProjects(session.token).catch((err: Error) => setStatus(err.message));
  }, []);

  async function loadProjects(nextToken = token) {
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const stored = readProjectId();
    const nextProjectId = json.data.some((project) => project.id === stored) ? stored : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await Promise.all([loadRooms(nextToken, nextProjectId), loadTradeCategories(nextToken, nextProjectId), loadReports(nextToken, nextProjectId)]);
    }
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<RoomList>(`/projects/${nextProjectId}/rooms`, { headers: authHeaders(nextToken) });
    setRooms(json.data);
  }

  async function loadTradeCategories(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<TradeCategoryList>(`/projects/${nextProjectId}/trade-categories`, { headers: authHeaders(nextToken) });
    setTradeCategories(json.data);
  }

  async function loadReports(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<ReportList>(`/reports?project_id=${nextProjectId}`, { headers: authHeaders(nextToken) });
    setReports(json.data);
    setSelectedId(json.data[0]?.id ?? "");
    setStatus(`${json.data.length}개 보고서를 불러왔습니다.`);
  }

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    saveProjectId(nextProjectId);
    setSelectedId("");
    setFilters((current) => ({ ...current, room_id: "", trade: "", trade_category_id: "" }));
    void Promise.all([loadRooms(token, nextProjectId), loadTradeCategories(token, nextProjectId), loadReports(token, nextProjectId)]).catch((err: Error) => setStatus(err.message));
  }

  function changeTrade(value: string) {
    if (tradeCategories.some((category) => category.id === value)) {
      const category = tradeCategories.find((item) => item.id === value);
      setFilters((current) => ({ ...current, trade_category_id: value, trade: legacyTradeValue(category?.code ?? "OTHER") }));
      return;
    }
    setFilters((current) => ({ ...current, trade_category_id: "", trade: value }));
  }

  function reportRequestBase() {
    return {
      project_id: projectId,
      room_id: filters.room_id || undefined,
      work_surface: filters.work_surface || undefined,
      trade: filters.trade || undefined,
      trade_category_id: filters.trade_category_id || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      worker_name: filters.worker_name || undefined
    };
  }

  async function generateReport() {
    if (!projectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    setGenerating(true);
    try {
      const json = await apiJson<ReportResult>("/reports/generate", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...reportRequestBase(),
          title: filters.title || undefined,
          memo: filters.memo || undefined,
          ai_prompt: filters.ai_prompt || undefined,
          format: "JSON"
        })
      });
      await loadReports(token, projectId);
      setSelectedId(json.data.id);
      setStatus(`${json.data.title} 보고서를 생성했습니다.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "보고서 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function downloadReportFile(report: GeneratedReport) {
    const res = await fetch(`${API_BASE}/reports/${report.id}/export?format=DOCX`, { headers: authHeaders(token) });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => ({}));
      throw new Error(errorMessage(json, `API error ${res.status}`));
    }
    downloadBlob(await res.blob(), filenameFromDisposition(res.headers.get("content-disposition")) ?? `${report.title}.docx`);
  }

  function requestDownload(report: GeneratedReport) {
    void downloadReportFile(report).catch((err: Error) => setStatus(err.message));
  }

  const canGenerate = isUpperManager(user);
  const filteredReports = useMemo(() => {
    const keyword = filters.title.trim().toLowerCase();
    return reports.filter((report) => {
      if (ownerFilter === "MINE" && report.created_by.id !== user?.id) return false;
      if (keyword && !report.title.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [reports, filters.title, ownerFilter, user?.id]);
  const selectedReport = useMemo(() => {
    return filteredReports.find((report) => report.id === selectedId) ?? filteredReports[0] ?? reports.find((report) => report.id === selectedId);
  }, [filteredReports, reports, selectedId]);
  const selectedTradeValue = filters.trade_category_id || filters.trade;

  if (!user) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">보고서는 프로젝트 권한 안에서만 조회됩니다.</p>
        <a className="button" href="/login">로그인으로 이동</a>
      </section>
    );
  }

  if (!canAccessAdminBoards(user)) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">관리자 권한이 필요합니다</h1>
        <p className="muted">보고서 보드는 관리자 계정에서만 표시됩니다.</p>
        <a className="button" href="/dashboard">대시보드로 이동</a>
      </section>
    );
  }

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">보고서</h1>
          <p className="muted">사진 분석 결과를 프로젝트, 방, 공사면, 공종, 작업일자, 작성자 기준으로 보고서화합니다.</p>
        </div>
      </header>

      {!canGenerate ? (
        <section className="permission-banner">
          <KeyRound size={18} />
          <span>보고서 생성은 상위관리자 권한이 필요합니다.</span>
        </section>
      ) : null}

      <section className="panel filter-panel">
        <label className="field compact">
          <span className="label">프로젝트</span>
          <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="field compact">
          <span className="label">방</span>
          <select className="input" value={filters.room_id} onChange={(event) => setFilters({ ...filters, room_id: event.target.value })}>
            <option value="">전체</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.level_name ?? "-"} / {room.room_number ?? ""} {room.room_name}</option>)}
          </select>
        </label>
        <label className="field compact">
          <span className="label">공사면</span>
          <select className="input" value={filters.work_surface} onChange={(event) => setFilters({ ...filters, work_surface: event.target.value })}>
            <option value="">전체</option>
            {defaultSurfaceOptions.map((surface) => <option key={surface.value} value={surface.value}>{surface.label}</option>)}
          </select>
        </label>
        <label className="field compact">
          <span className="label">공종</span>
          <select className="input" value={selectedTradeValue} onChange={(event) => changeTrade(event.target.value)}>
            <option value="">전체</option>
            {tradeCategories.length > 0
              ? tradeCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)
              : legacyTrades.filter((trade) => trade).map((trade) => <option key={trade} value={trade}>{labelForOption(defaultTradeOptions, trade)}</option>)}
          </select>
        </label>
        <label className="field compact">
          <span className="label">시작일</span>
          <input className="input" type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        </label>
        <label className="field compact">
          <span className="label">종료일</span>
          <input className="input" type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        </label>
        <label className="field compact">
          <span className="label">작성자</span>
          <input className="input" value={filters.worker_name} onChange={(event) => setFilters({ ...filters, worker_name: event.target.value })} placeholder="작업자명" />
        </label>
        <label className="search-box report-search">
          <Search size={17} />
          <input value={filters.title} onChange={(event) => setFilters({ ...filters, title: event.target.value })} placeholder="보고서 제목 검색 또는 생성 제목" />
        </label>
        <label className="field compact report-instruction-field">
          <span className="label">AI 지시문</span>
          <textarea
            className="input"
            value={filters.ai_prompt}
            onChange={(event) => setFilters({ ...filters, ai_prompt: event.target.value })}
            placeholder="예: 지난 7일간 공정 지연 원인과 완료 근거를 중심으로 작성해줘"
          />
        </label>
        <button className="button" type="button" disabled={!canGenerate || generating} onClick={generateReport}>
          <Plus size={16} /> {generating ? "생성 중" : "보고서 생성"}
        </button>
      </section>

      <section className="reports-layout">
        <article className="panel ref-card">
          <div className="report-list-head">
            <div className="tab-row">
              <button className={ownerFilter === "ALL" ? "active" : ""} type="button" onClick={() => setOwnerFilter("ALL")}>전체</button>
              <button className={ownerFilter === "MINE" ? "active" : ""} type="button" onClick={() => setOwnerFilter("MINE")}>내 보고서</button>
            </div>
            <label className="field compact">
              <span className="label">보고서 프로젝트</span>
              <select className="input" value={projectId} onChange={(event) => changeProject(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          </div>
          <div className="room-table-wrap">
            <table className="room-table ref-table">
              <thead>
                <tr>
                  <th>보고서 제목</th>
                  <th>프로젝트</th>
                  <th>생성자</th>
                  <th>생성일</th>
                  <th>사진</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => (
                  <tr className={report.id === selectedReport?.id ? "selected" : ""} key={report.id} onClick={() => setSelectedId(report.id)}>
                    <td><FileText size={15} /> {report.title}</td>
                    <td>{report.project?.name ?? report.project_id}</td>
                    <td>{report.created_by.name}</td>
                    <td>{new Date(report.created_at).toLocaleString("ko-KR")}</td>
                    <td>{report.photo_ids.length}</td>
                    <td><span className={report.status === "GENERATED" ? "badge green" : "badge red"}>{reportStatusLabel(report.status)}</span></td>
                    <td className="table-actions">
                      <button className="icon-button" type="button" aria-label="미리보기" onClick={(event) => { event.stopPropagation(); setSelectedId(report.id); }}><Eye size={16} /></button>
                      <button className="icon-button" type="button" aria-label="Word 다운로드" onClick={(event) => { event.stopPropagation(); requestDownload(report); }}><Download size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredReports.length === 0 ? <div className="empty">생성된 보고서가 없습니다.</div> : null}
          </div>
          <p className="muted">{status}</p>
        </article>

        <aside className="panel ref-card report-detail">
          {selectedReport ? (
            <>
              <div className="report-detail-head">
                <h2>{selectedReport.title}</h2>
                <span className="badge green">{reportStatusLabel(selectedReport.status)}</span>
              </div>
              <dl className="detail-definition">
                <dt>생성일</dt><dd>{new Date(selectedReport.created_at).toLocaleString("ko-KR")}</dd>
                <dt>생성자</dt><dd>{selectedReport.created_by.name}</dd>
                <dt>사진 수</dt><dd>{selectedReport.photo_ids.length}</dd>
              </dl>
              <h3 className="section-title">상황분석</h3>
              <p className="muted">{selectedReport.content.analysis_result}</p>
              {selectedReport.error_message ? <p className="muted">Gemini 대체 결과: {selectedReport.error_message}</p> : null}
              <div className="report-actions">
                <button className="button" type="button" onClick={() => requestDownload(selectedReport)}><FileText size={16} />Word 내보내기</button>
              </div>
            </>
          ) : (
            <div className="empty">보고서를 선택하거나 생성하세요.</div>
          )}
        </aside>
      </section>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(disposition: string | null) {
  if (!disposition) return null;
  const match = /filename="?([^"]+)"?/i.exec(decodeURIComponent(disposition));
  return match?.[1] ?? null;
}

function errorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const message = record.message ?? (record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>).message : undefined);
  if (Array.isArray(message)) return message.map(String).join(", ");
  if (typeof message === "string") return message;
  return fallback;
}

function reportStatusLabel(status: string) {
  if (status === "GENERATED") return "생성 완료";
  if (status === "FAILED") return "생성 실패";
  return status;
}
