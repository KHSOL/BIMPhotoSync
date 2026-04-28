"use client";

import {
  Box,
  Camera,
  ChevronRight,
  Crosshair,
  Eye,
  Filter,
  KeyRound,
  Layers,
  MousePointer2,
  Move,
  Ruler,
  Search,
  Settings,
  Star,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { readSession } from "../client";

const levels = ["옥상", "5F", "4F", "3F", "2F", "1F", "B1F", "B2F"];
const viewList = ["3F 평면도", "3F 천장 평면도", "3F 3D 뷰 (ISO)", "3F 단면도 A-A'", "3F 단면도 B-B'"];

export default function ViewerPage() {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    setHasSession(!!readSession());
  }, []);

  if (!hasSession) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">도면 Viewer는 프로젝트 권한 안에서만 조회됩니다.</p>
        <a className="button" href="/login">
          로그인으로 이동
        </a>
      </section>
    );
  }

  return (
    <div className="reference-page viewer-page">
      <section className="viewer-toolbar panel">
        <label className="field compact">
          <span className="label">프로젝트</span>
          <select className="input" defaultValue="A현장">
            <option>A현장</option>
          </select>
        </label>
        <label className="field compact">
          <span className="label">모델</span>
          <select className="input" defaultValue="A현장_건축_2026.rvt">
            <option>A현장_건축_2026.rvt</option>
          </select>
        </label>
        <label className="field compact">
          <span className="label">뷰</span>
          <select className="input" defaultValue="3F 평면도">
            <option>3F 평면도</option>
          </select>
        </label>
        <div className="tool-segment">
          <button className="active" type="button"><MousePointer2 size={17} />선택</button>
          <button type="button"><Ruler size={17} />측정</button>
          <button type="button"><Crosshair size={17} />주석</button>
          <button type="button"><Box size={17} />단면</button>
        </div>
        <div className="tool-segment small">
          <button className="active" type="button">2D</button>
          <button type="button">3D</button>
        </div>
        <button className="filter-button" type="button"><Filter size={16} />필터</button>
      </section>

      <section className="viewer-layout">
        <aside className="panel viewer-tree">
          <h2 className="section-title">층/뷰</h2>
          <label className="search-box">
            <Search size={16} />
            <input placeholder="층 이름 검색" />
          </label>
          <div className="tree-group">
            <strong><Layers size={16} /> 전체 모델</strong>
            {levels.map((level) => (
              <button className={level === "3F" ? "active" : ""} key={level} type="button">
                <span>{level}</span>
                <small>{level === "3F" ? <Eye size={14} /> : level.replace("F", "")}</small>
              </button>
            ))}
          </div>
          <div className="tree-group">
            <h3>뷰 목록</h3>
            {viewList.map((view) => (
              <button className={view === "3F 평면도" ? "active" : ""} key={view} type="button">
                <span>{view}</span>
                {view === "3F 평면도" ? <Eye size={14} /> : null}
              </button>
            ))}
          </div>
        </aside>

        <main className="viewer-main">
          <div className="floor-plan">
            {["301 회의실", "302 사무실", "303 사무실", "304 회의실", "305 휴게실", "306 창고", "310 사무실", "309 사무실", "308 회의실", "307 사무실"].map((room, index) => (
              <div className={`floor-room r${index + 1}`} key={room}>
                <span>{room.split(" ")[0]}</span>
                <small>{room.split(" ")[1]}</small>
              </div>
            ))}
            <div className="floor-room selected-room">
              <strong>101</strong>
              <span>욕실</span>
              <div className="map-pin" />
            </div>
            <div className="dimension-line top" />
            <div className="dimension-line left" />
          </div>
          <div className="floating-tools">
            <button type="button"><Move size={19} /></button>
            <button className="active" type="button"><MousePointer2 size={19} /></button>
            <button type="button"><Crosshair size={19} /></button>
            <button type="button"><Box size={19} /></button>
            <button type="button"><Ruler size={19} /></button>
            <button type="button"><Settings size={19} /></button>
          </div>
        </main>

        <aside className="viewer-side">
          <section className="panel ref-card selected-room-card">
            <div className="room-detail-head">
              <h2>선택된 Room</h2>
              <X size={18} />
            </div>
            <h3><span className="badge blue">진행중</span>101 욕실 <Star size={17} /></h3>
            <dl className="detail-definition">
              <dt>층 / 영역</dt><dd>3F</dd>
              <dt>면적</dt><dd>5.23 m²</dd>
              <dt>공종</dt><dd>방수</dd>
              <dt>공사면</dt><dd>바닥</dd>
              <dt>담당자</dt><dd>김작업</dd>
              <dt>공정 진행률</dt><dd><div className="inline-progress wide"><span><i style={{ "--value": "72%" } as React.CSSProperties} /></span><b>72%</b></div></dd>
              <dt>상태</dt><dd><span className="badge blue">진행중</span></dd>
              <dt>최근 업데이트</dt><dd>2026-03-05 09:12</dd>
            </dl>
            <a className="button secondary" href="/photos">Room 상세 정보 보기 <ChevronRight size={15} /></a>
          </section>
          <section className="panel ref-card">
            <h2 className="section-title">연결 정보</h2>
            <dl className="detail-definition">
              <dt>모델 파일</dt><dd>A현장_건축_2026.rvt</dd>
              <dt>모델 버전</dt><dd>v2 (2026-02-28)</dd>
              <dt>Room ID</dt><dd>room_3f_101</dd>
              <dt>외부 ID</dt><dd><code>a1b2c3d4-101</code></dd>
            </dl>
            <button className="button secondary" type="button">BIM Add-in에서 열기</button>
          </section>
        </aside>
      </section>

      <section className="panel ref-card viewer-photo-strip">
        <div className="ref-panel-title">
          <h2>101 욕실 관련 사진 <span className="count-badge">18</span></h2>
          <a href="/photos">모든 사진 보기 <ChevronRight size={14} /></a>
        </div>
        <div className="strip-photos">
          {[1, 2, 3, 4, 5].map((item) => (
            <article className={item === 1 ? "strip-photo active" : "strip-photo"} key={item}>
              <div className="photo-fallback" />
              <strong>2026-03-0{item + 1} 09:12</strong>
              <span>{item % 2 ? "바닥 · 방수" : "벽 · 방수"}</span>
            </article>
          ))}
          <button className="more-photo" type="button"><Camera size={25} />더보기</button>
        </div>
      </section>
    </div>
  );
}
