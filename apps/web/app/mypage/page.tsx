"use client";

import { Building2, KeyRound, Mail, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { apiJson, authHeaders, readSession, saveSession, type User } from "../client";

type MeResult = {
  data: {
    id: string;
    email: string;
    name: string;
    role: string;
    company: { id: string; name: string };
  };
};

export default function MyPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const session = readSession();
    if (!session) return;
    setToken(session.token);
    setUser(session.user);
  }, []);

  async function refreshMe() {
    if (!token) return;
    const json = await apiJson<MeResult>("/auth/me", { headers: authHeaders(token) });
    const nextUser: User = {
      id: json.data.id,
      company_id: json.data.company.id,
      company_name: json.data.company.name,
      email: json.data.email,
      name: json.data.name,
      role: json.data.role
    };
    saveSession(token, nextUser);
    setUser(nextUser);
    setStatus("내 정보를 새로고침했습니다.");
  }

  if (!user) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">내 정보는 로그인 후 확인할 수 있습니다.</p>
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
          <h1 className="page-title">My Page</h1>
          <p className="muted">계정, 회사, 권한, 설치 안내를 확인합니다.</p>
        </div>
        <button className="filter-button" type="button" onClick={() => refreshMe().catch((error) => setStatus(error.message))}>
          <RefreshCw size={16} />
          새로고침
        </button>
      </header>

      <section className="mypage-grid">
        <article className="panel">
          <div className="panel-header">
            <h2 className="panel-title">계정 정보</h2>
            <UserRound size={20} />
          </div>
          <dl className="info-list">
            <div>
              <dt>이름</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>이메일</dt>
              <dd><Mail size={15} /> {user.email}</dd>
            </div>
            <div>
              <dt>역할</dt>
              <dd><ShieldCheck size={15} /> {roleLabel(user.role)}</dd>
            </div>
            <div>
              <dt>회사</dt>
              <dd><Building2 size={15} /> {user.company_name ?? user.company_id}</dd>
            </div>
          </dl>
          {status ? <p className="muted">{status}</p> : null}
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Revit Add-in 사용</h2>
            <span className="badge blue">Windows / Revit 2025</span>
          </div>
          <div className="revit-import-steps">
            <span>1. Revit에서 BIM Photo Sync 탭을 엽니다.</span>
            <span>2. Connect Project에서 이 계정으로 로그인합니다.</span>
            <span>3. 프로젝트를 선택하거나 새 프로젝트를 생성합니다.</span>
            <span>4. Sync Rooms와 Sync Floor Plan을 실행합니다.</span>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2 className="panel-title">모바일 앱 사용</h2>
            <span className="badge green">iOS / Android</span>
          </div>
          <p className="muted">
            설치형 테스트는 EAS internal build로 배포합니다. 현장 사용자는 모바일 앱에서 프로젝트와 Room을 선택하고 사진을 업로드합니다.
          </p>
        </article>
      </section>
    </div>
  );
}

function roleLabel(role: string) {
  if (role === "SUPER_ADMIN") return "최고관리자";
  if (role === "COMPANY_ADMIN" || role === "PROJECT_ADMIN" || role === "BIM_MANAGER") return "상위 관리자";
  if (role === "MANAGER") return "관리자";
  return "일반 사용자";
}
