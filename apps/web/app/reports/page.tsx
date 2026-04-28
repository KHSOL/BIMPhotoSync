"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  KeyRound,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  Users
} from "lucide-react";
import { useEffect, useState } from "react";
import { isUpperManager, readSession, User } from "../client";

const reports = [
  ["주간 현장 보고서 (3월 1주차)", "A현장 / 전체", "주간 보고서", "김관리", "2026-03-07 09:30", "완료"],
  ["방수 점검 보고서 (3F)", "A현장 / 3F", "검측 보고서", "이작업", "2026-03-06 16:20", "완료"],
  ["월간 진행 보고서 (2월)", "A현장 / 전체", "월간 보고서", "김관리", "2026-03-03 14:10", "완료"],
  ["AI 분석 리포트 (주간)", "A현장 / 전체", "AI 분석 리포트", "시스템", "2026-03-03 09:10", "완료"],
  ["타일 시공 상태 보고서 (2F)", "A현장 / 2F", "공종 보고서", "박작업", "2026-03-02 11:45", "공유됨"],
  ["설비 설치 진행 보고서", "A현장 / 전체", "공종 보고서", "최작업", "2026-03-01 17:30", "생성 중"],
  ["층별 공정 요약 보고서", "A현장 / 전체", "요약 보고서", "김관리", "2026-02-28 10:05", "실패"]
];

export default function ReportsPage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setUser(readSession()?.user ?? null);
  }, []);

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

  const canGenerate = isUpperManager(user);

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="muted">프로젝트의 보고서를 생성하고 관리합니다.</p>
        </div>
        <button className="button" type="button" disabled={!canGenerate} title={canGenerate ? "보고서 생성" : "상위 관리자만 보고서를 생성할 수 있습니다."}>
          <Plus size={16} /> 보고서 생성
        </button>
      </header>

      {!canGenerate ? (
        <section className="permission-banner">
          <KeyRound size={18} />
          <span>일반 사용자는 보고서 조회만 가능합니다. 보고서 생성은 상위 관리자 권한이 필요합니다.</span>
        </section>
      ) : null}

      <section className="panel filter-panel">
        <label className="field compact">
          <span className="label">프로젝트</span>
          <select className="input"><option>A현장</option></select>
        </label>
        <label className="field compact">
          <span className="label">보고서 유형</span>
          <select className="input"><option>전체</option><option>주간 보고서</option><option>공종 보고서</option></select>
        </label>
        <label className="field compact">
          <span className="label">기간</span>
          <button className="input input-button" type="button"><CalendarDays size={16} />2026-03-01 ~ 2026-03-07</button>
        </label>
        <label className="field compact">
          <span className="label">생성자</span>
          <select className="input"><option>전체</option><option>김관리</option></select>
        </label>
        <label className="search-box report-search">
          <Search size={17} />
          <input placeholder="보고서 제목 검색" />
        </label>
        <button className="filter-button" type="button"><Filter size={16} />필터 초기화</button>
      </section>

      <section className="metric-grid five">
        <Metric icon={<FileText />} label="전체 보고서" value="62" sub="전체 보고서 수" tone="blue" />
        <Metric icon={<Eye />} label="완료" value="38" sub="61%" tone="green" />
        <Metric icon={<CalendarDays />} label="생성 중" value="6" sub="10%" tone="orange" />
        <Metric icon={<Send />} label="공유됨" value="24" sub="39%" tone="purple" />
        <Metric icon={<Download />} label="다운로드" value="156" sub="이번 주 다운로드 수" tone="sky" />
      </section>

      <section className="reports-layout">
        <article className="panel ref-card">
          <div className="tab-row">
            <button className="active" type="button">전체</button>
            <button type="button">내 보고서</button>
            <button type="button">공유된 보고서</button>
            <button type="button">즐겨찾기</button>
          </div>
          <div className="room-table-wrap">
            <table className="room-table ref-table">
              <thead>
                <tr>
                  <th>보고서 제목</th>
                  <th>프로젝트 / 범위</th>
                  <th>보고서 유형</th>
                  <th>생성자</th>
                  <th>생성일</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(([title, scope, type, author, date, state], index) => (
                  <tr className={index === 0 ? "selected" : ""} key={title}>
                    <td>{index === 0 ? <Star size={15} className="star-fill" /> : <FileText size={15} />} {title}</td>
                    <td>{scope}</td>
                    <td>{type}</td>
                    <td>{author}</td>
                    <td>{date}</td>
                    <td><span className={`badge ${state === "완료" ? "green" : state === "공유됨" ? "blue" : state === "실패" ? "red" : "orange"}`}>{state}</span></td>
                    <td className="table-actions"><Eye size={16} /><Download size={16} /><MoreHorizontal size={16} /></td>
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
              <button className="icon-button" type="button"><ChevronRight size={15} /></button>
            </div>
          </div>
        </article>

        <aside className="panel ref-card report-detail">
          <div className="report-detail-head">
            <h2>주간 현장 보고서 (3월 1주차)</h2>
            <span className="badge green">완료</span>
            <Star size={17} className="star-fill" />
          </div>
          <div className="report-preview">
            <div className="report-cover">
              <strong>BIM PHOTO SYNC</strong>
              <span>REPORT</span>
              <div className="cover-photo"><div className="photo-fallback" /></div>
            </div>
            <dl className="detail-definition">
              <dt>보고서 유형</dt><dd>주간 보고서</dd>
              <dt>프로젝트 / 범위</dt><dd>A현장 / 전체</dd>
              <dt>생성자</dt><dd>김관리</dd>
              <dt>생성일</dt><dd>2026-03-07 09:30</dd>
              <dt>페이지 수</dt><dd>24</dd>
              <dt>파일 크기</dt><dd>8.4 MB</dd>
              <dt>공유 상태</dt><dd>공유됨 (5명)</dd>
            </dl>
          </div>
          <p className="muted">3월 1주차 전체 공정 진행 현황과 주요 이슈를 정리한 주간 보고서입니다.</p>
          <div className="badge-row">
            <span className="badge">공정 진행률</span>
            <span className="badge">주요 이슈</span>
            <span className="badge">AI 분석 요약</span>
            <span className="badge">사진 요약</span>
          </div>
          <div className="report-actions">
            <button className="button" type="button"><Eye size={16} />열람하기</button>
            <button className="button secondary" type="button"><Download size={16} />다운로드</button>
            <button className="button secondary" type="button" disabled={!canGenerate}><Users size={16} />공유 관리</button>
            <button className="danger-button" type="button" disabled={!canGenerate}><Trash2 size={16} />삭제</button>
          </div>
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
