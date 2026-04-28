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
import { readSession } from "../client";

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

const recentLogins = [
  ["LM", "이관리 (Manager)", "2026-03-07 14:28:11", "성공"],
  ["JK", "김작업 (Worker)", "2026-03-07 14:21:33", "성공"],
  ["BM", "박BIM (BIM Manager)", "2026-03-07 13:55:18", "성공"],
  ["PA", "프로젝트 관리자", "2026-03-07 13:30:12", "성공"],
  ["TV", "test.user (Viewer)", "2026-03-07 12:45:02", "실패"]
];

export default function AuditPage() {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    setHasSession(!!readSession());
  }, []);

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
        <select className="input"><option>전체 프로젝트</option></select>
        <select className="input"><option>전체 사용자</option></select>
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
        <Metric icon={<LockKeyhole />} label="로그인" value="311" sub="▲ 8.3%" tone="sky" />
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
                {logRows.map(([time, user, project, action, resource, detail, ip]) => (
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
              <a href="/audit">전체 보기 <ChevronRight size={14} /></a>
            </div>
            <div className="login-activity-list">
              {recentLogins.map(([avatar, name, time, state]) => (
                <div className="login-activity-row" key={`${name}-${time}`}>
                  <span>{avatar}</span>
                  <strong>{name}</strong>
                  <time>{time}</time>
                  <em className={state === "성공" ? "success" : "fail"}>{state}</em>
                </div>
              ))}
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
