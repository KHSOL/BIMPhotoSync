"use client";

import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  Filter,
  Home,
  Image as ImageIcon,
  KeyRound,
  ShieldCheck
} from "lucide-react";
import { useEffect, useState } from "react";
import { readSession } from "../client";

const tradeRows = [
  ["방수", "72%", "54 / 75"],
  ["타일", "68%", "45 / 66"],
  ["전기", "61%", "33 / 54"],
  ["도장", "58%", "29 / 50"],
  ["설비", "55%", "22 / 40"]
];

const floorBars = [
  ["B2", "32%"],
  ["B1", "45%"],
  ["1F", "61%"],
  ["2F", "68%"],
  ["3F", "72%"],
  ["4F", "64%"],
  ["5F", "58%"],
  ["6F", "42%"]
];

const recentPhotos = [
  ["101 욕실 - 바닥 방수", "방수 | 바닥 | 김작업", "2026-03-05 09:12"],
  ["102 침실 - 전기 배선", "전기 | 벽 | 이작업", "2026-03-05 08:45"],
  ["103 거실 - 타일 시공", "타일 | 바닥 | 박작업", "2026-03-05 08:30"],
  ["104 주방 - 설비 배관", "설비 | 천장 | 최작업", "2026-03-05 08:15"]
];

const reports = [
  ["방수 점검 보고서 (3F)", "2026-03-05 10:30 | 김관리"],
  ["주간 현장 보고서", "2026-03-04 17:20 | 이관리"],
  ["AI 분석 리포트", "2026-03-04 09:10 | 시스템"],
  ["타일 시공 보고서", "2026-03-03 16:45 | 박관리"]
];

export default function DashboardPage() {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    setHasSession(!!readSession());
  }, []);

  if (!hasSession) {
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

  return (
    <div className="reference-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted">프로젝트 전체 현황을 한눈에 확인하세요.</p>
        </div>
        <div className="header-actions">
          <button className="filter-button" type="button">
            <CalendarDays size={16} />
            2026-03-01 ~ 2026-03-07
            <ChevronRight size={14} />
          </button>
          <button className="filter-button" type="button">
            <Filter size={16} />
            필터
          </button>
        </div>
      </header>

      <section className="metric-grid six">
        <Metric icon={<Home />} label="전체 Rooms" value="248" sub="전체 등록된 Room 수" tone="blue" />
        <Metric icon={<CheckCircle2 />} label="진행 중 Rooms" value="162" sub="전체의 65%" tone="green" />
        <Metric icon={<ShieldCheck />} label="완료 Rooms" value="78" sub="전체의 31%" tone="orange" />
        <Metric icon={<AlertCircle />} label="이슈 Rooms" value="8" sub="전체의 4%" tone="red" />
        <Metric icon={<Camera />} label="이번 주 업로드" value="254" sub="전체 사진 수" tone="purple" />
        <Metric icon={<ImageIcon />} label="AI 분석 완료" value="198" sub="분석 완료된 사진 수" tone="sky" />
      </section>

      <section className="dashboard-panels">
        <article className="panel ref-card">
          <PanelTitle title="공종별 진행률" />
          <div className="trade-progress-list">
            {tradeRows.map(([name, value, count]) => (
              <div className="trade-progress" key={name}>
                <span>{name}</span>
                <div className="progress">
                  <span style={{ "--value": value } as React.CSSProperties} />
                </div>
                <strong>{value}</strong>
                <small>{count}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="층별 진행률" />
          <div className="bar-chart">
            {floorBars.map(([floor, value]) => (
              <div className="bar-column" key={floor}>
                <strong>{value}</strong>
                <span style={{ "--value": value } as React.CSSProperties} />
                <small>{floor}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="공정 상태 분포" />
          <div className="donut-card">
            <div className="donut big">
              <strong>248</strong>
              <span>Total</span>
            </div>
            <ul className="legend-list">
              <li><i className="blue-dot" />진행중 <strong>65% (162)</strong></li>
              <li><i className="green-dot" />완료 <strong>31% (78)</strong></li>
              <li><i className="orange-dot" />검토중 <strong>2% (5)</strong></li>
              <li><i className="red-dot" />이슈 <strong>2% (3)</strong></li>
            </ul>
          </div>
        </article>
      </section>

      <section className="dashboard-panels bottom">
        <article className="panel ref-card">
          <PanelTitle title="최근 업로드 사진" href="/photos" />
          <div className="recent-photo-list">
            {recentPhotos.map(([title, meta, time]) => (
              <div className="recent-photo-row" key={title}>
                <div className="photo-thumb"><div className="photo-fallback" /></div>
                <div>
                  <strong>{title}</strong>
                  <span>{meta}</span>
                </div>
                <time>{time}</time>
                <ChevronRight size={15} />
              </div>
            ))}
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="AI 분석 상태" />
          <div className="analysis-status">
            <div className="ring" style={{ "--progress": "76%" } as React.CSSProperties}>
              <span>198</span>
            </div>
            <div className="analysis-summary">
              <p><i className="blue-dot" />분석 완료 <strong>198 (76%)</strong></p>
              <p><i className="orange-dot" />분석 중 <strong>34 (13%)</strong></p>
              <p><i className="gray-dot" />대기 중 <strong>29 (11%)</strong></p>
            </div>
          </div>
          <div className="issue-box">
            <strong>AI 이슈 감지 Top 3</strong>
            <span>방수 누락 <b>12건</b></span>
            <span>균열 발생 <b>8건</b></span>
            <span>자재 오염 <b>6건</b></span>
          </div>
        </article>

        <article className="panel ref-card">
          <PanelTitle title="최근 보고서" href="/reports" />
          <div className="report-list">
            {reports.map(([title, meta]) => (
              <div className="report-row" key={title}>
                <FileText size={20} />
                <div>
                  <strong>{title}</strong>
                  <span>{meta}</span>
                </div>
                <Download size={16} />
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel ref-card job-queue-card">
        <PanelTitle title="Job Queue" href="/audit" />
        <div className="job-queue-grid">
          <span><BarChart3 size={16} />101 욕실 - 20260305_사진분석 <b>분석 중</b></span>
          <div className="progress"><span style={{ "--value": "45%" } as React.CSSProperties} /></div>
          <span>102 침실 - 20260305_사진분석 <b>대기 중</b></span>
          <span>103 거실 - 20260305_사진분석 <b>대기 중</b></span>
        </div>
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

function PanelTitle({ title, href }: { title: string; href?: string }) {
  return (
    <div className="ref-panel-title">
      <h2>{title}</h2>
      {href ? (
        <a href={href}>
          전체 보기 <ChevronRight size={14} />
        </a>
      ) : (
        <a href="/dashboard">
          전체 보기 <ChevronRight size={14} />
        </a>
      )}
    </div>
  );
}
