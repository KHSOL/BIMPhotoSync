"use client";

import { CalendarDays, Download, Eye, FileSpreadsheet, FileText, Filter, KeyRound, Plus, Search } from "lucide-react";
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
type ExportFormat = "JSON" | "XLSX" | "DOCX";

export default function ReportsPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tradeCategories, setTradeCategories] = useState<TradeCategory[]>([]);
  const [reports, setReports] = useState<GeneratedReport[]>([]);
  const [selectedId, setSelectedId] = useState("");
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
    memo: ""
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
    void loadProjects(session.token).catch((err) => setStatus(err.message));
  }, []);

  async function loadProjects(nextToken = token) {
    const json = await apiJson<ProjectList>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const stored = readProjectId();
    const nextProjectId = json.data.some((project) => project.id === stored) ? stored : json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) {
      saveProjectId(nextProjectId);
      await Promise.all([
        loadRooms(nextToken, nextProjectId),
        loadTradeCategories(nextToken, nextProjectId),
        loadReports(nextToken, nextProjectId)
      ]);
    }
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<RoomList>(`/projects/${nextProjectId}/rooms`, { headers: authHeaders(nextToken) });
    setRooms(json.data);
  }

  async function loadTradeCategories(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) return;
    const json = await apiJson<TradeCategoryList>(`/projects/${nextProjectId}/trade-categories`, {
      headers: authHeaders(nextToken)
    });
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
    void Promise.all([
      loadRooms(token, nextProjectId),
      loadTradeCategories(token, nextProjectId),
      loadReports(token, nextProjectId)
    ]).catch((err) => setStatus(err.message));
  }

  function changeTrade(value: string) {
    if (tradeCategories.some((category) => category.id === value)) {
      const category = tradeCategories.find((item) => item.id === value);
      setFilters((current) => ({
        ...current,
        trade_category_id: value,
        trade: legacyTradeValue(category?.code ?? "OTHER")
      }));
      return;
    }
    setFilters((current) => ({ ...current, trade_category_id: "", trade: value }));
  }

  function resetFilters() {
    setFilters({
      room_id: "",
      work_surface: "",
      trade: "",
      trade_category_id: "",
      date_from: "",
      date_to: "",
      worker_name: "",
      title: "",
      memo: ""
    });
    setStatus("보고서 생성 필터를 초기화했습니다.");
  }

  async function generateReport() {
    if (!projectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    setGenerating(true);
    try {
      const body = {
        project_id: projectId,
        room_id: filters.room_id || undefined,
        work_surface: filters.work_surface || undefined,
        trade: filters.trade || undefined,
        trade_category_id: filters.trade_category_id || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        worker_name: filters.worker_name || undefined,
        title: filters.title || undefined,
        memo: filters.memo || undefined,
        format: "JSON"
      };
      const json = await apiJson<ReportResult>("/reports/generate", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body)
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

  async function downloadReportFile(report: GeneratedReport, format: ExportFormat) {
    if (format === "JSON") {
      const blob = new Blob([JSON.stringify(report.content, null, 2)], { type: "application/json;charset=utf-8" });
      downloadBlob(blob, `${report.title}.json`);
      return;
    }
    const res = await fetch(`${API_BASE}/reports/${report.id}/export?format=${format}`, { headers: authHeaders(token) });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const message = json?.error?.message ?? json?.message ?? `API error ${res.status}`;
      throw new Error(Array.isArray(message) ? message.join(", ") : message);
    }
    const disposition = res.headers.get("content-disposition");
    const fallbackName = format === "XLSX" ? `${report.title}.xls` : `${report.title}.doc`;
    const filename = filenameFromDisposition(disposition) ?? fallbackName;
    downloadBlob(await res.blob(), filename);
  }

  function requestDownload(report: GeneratedReport, format: ExportFormat) {
    void downloadReportFile(report, format).catch((err) => setStatus(err.message));
  }

  const canGenerate = isUpperManager(user);
  const selectedReport = useMemo(() => reports.find((report) => report.id === selectedId) ?? reports[0], [reports, selectedId]);
  const filteredReports = useMemo(() => {
    const keyword = filters.title.trim().toLowerCase();
    if (!keyword) return reports;
    return reports.filter((report) => report.title.toLowerCase().includes(keyword));
  }, [reports, filters.title]);
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
          <p className="muted">사진 분석 결과를 프로젝트, 실, 공사면, 공종, 작업일자, 작성자 기준으로 보고서화합니다.</p>
        </div>
        <button className="button" type="button" disabled={!canGenerate || generating} onClick={generateReport}>
          <Plus size={16} /> {generating ? "생성 중" : "보고서 생성"}
        </button>
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
          <span className="label">실</span>
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
        <button className="filter-button" type="button" onClick={resetFilters}><Filter size={16} />전체보기</button>
      </section>

      <section className="metric-grid five">
        <Metric icon={<FileText />} label="전체 보고서" value={String(reports.length)} sub="현재 프로젝트" tone="blue" />
        <Metric icon={<Eye />} label="생성 완료" value={String(reports.filter((r) => r.status === "GENERATED").length)} sub="저장된 보고서" tone="green" />
        <Metric icon={<CalendarDays />} label="최근 생성" value={selectedReport ? new Date(selectedReport.created_at).toLocaleDateString("ko-KR") : "-"} sub="선택 보고서" tone="orange" />
        <Metric icon={<Download />} label="사진 근거" value={String(selectedReport?.photo_ids.length ?? 0)} sub="선택 보고서" tone="purple" />
        <Metric icon={<FileSpreadsheet />} label="내보내기" value="3" sub="JSON / 엑셀 / 워드" tone="sky" />
      </section>

      <section className="reports-layout">
        <article className="panel ref-card">
          <div className="tab-row">
            <button className="active" type="button" onClick={() => loadReports().catch((err) => setStatus(err.message))}>전체</button>
            <button type="button" onClick={() => setReports((rows) => rows.filter((report) => report.created_by.id === user.id))}>내 보고서</button>
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
                      <button className="icon-button" type="button" aria-label="JSON 다운로드" onClick={(event) => { event.stopPropagation(); requestDownload(report, "JSON"); }}><Download size={16} /></button>
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
              <div className="report-preview">
                <div className="report-cover">
                  <strong>BIM PHOTO SYNC</strong>
                  <span>보고서</span>
                  <div className="cover-photo"><div className="photo-fallback" /></div>
                </div>
                <dl className="detail-definition">
                  <dt>생성일</dt><dd>{new Date(selectedReport.created_at).toLocaleString("ko-KR")}</dd>
                  <dt>생성자</dt><dd>{selectedReport.created_by.name}</dd>
                  <dt>모델</dt><dd>{selectedReport.model_provider} / {selectedReport.model_name}</dd>
                  <dt>사진 수</dt><dd>{selectedReport.photo_ids.length}</dd>
                  <dt>형식</dt><dd>{selectedReport.format}</dd>
                </dl>
              </div>
              <h3 className="section-title">상황분석</h3>
              <p className="muted">{selectedReport.content.analysis_result}</p>
              <h3 className="section-title">변화 과정</h3>
              <ul className="report-list compact-list">
                {selectedReport.content.progress_timeline.slice(0, 8).map((line) => <li key={line}>{line}</li>)}
              </ul>
              <h3 className="section-title">비교 사진 근거</h3>
              <div className="badge-row">
                {selectedReport.content.comparison_photos.slice(0, 6).map((photo) => (
                  <span className="badge" key={photo.photo_id}>{photo.work_date} / {photo.room}</span>
                ))}
              </div>
              {selectedReport.error_message ? <p className="muted">Gemini 대체 결과: {selectedReport.error_message}</p> : null}
              <div className="report-actions">
                <button className="button" type="button" onClick={() => requestDownload(selectedReport, "JSON")}><Download size={16} />JSON</button>
                <button className="button secondary" type="button" onClick={() => requestDownload(selectedReport, "XLSX")}><FileSpreadsheet size={16} />엑셀</button>
                <button className="button secondary" type="button" onClick={() => requestDownload(selectedReport, "DOCX")}><FileText size={16} />워드</button>
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
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  return match?.[1] ?? null;
}

function reportStatusLabel(status: string) {
  if (status === "GENERATED") return "생성 완료";
  if (status === "FAILED") return "생성 실패";
  return status;
}

function Metric({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: string }) {
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
