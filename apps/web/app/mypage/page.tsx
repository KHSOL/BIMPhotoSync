"use client";

import { Building2, ImagePlus, KeyRound, Mail, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { apiJson, authHeaders, readSession, saveSession, type User } from "../client";

type MeResult = {
  data: {
    id: string;
    email: string;
    name: string;
    role: string;
    company: { id: string; name: string };
    avatar_url?: string | null;
  };
};
type PresignResult = { data: { presigned_url: string; method: "PUT"; object_key: string } };
type AvatarResult = { data: { access_token: string; user: User } };

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
      role: json.data.role,
      avatar_url: json.data.avatar_url ?? null
    };
    saveSession(token, nextUser);
    setUser(nextUser);
    setStatus("계정 정보를 새로고침했습니다.");
  }

  async function changeAvatar(file: File | null) {
    if (!file || !token || !user) return;
    const mime = file.type || "image/jpeg";
    const presign = await apiJson<PresignResult>("/uploads/avatars/presign", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ mime_type: mime, file_size: file.size })
    });
    const putRes = await fetch(presign.data.presigned_url, { method: presign.data.method, headers: { "Content-Type": mime }, body: file });
    if (!putRes.ok) throw new Error(`Avatar upload failed: ${putRes.status}`);
    const json = await apiJson<AvatarResult>("/auth/me/avatar", {
      method: "PATCH",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ object_key: presign.data.object_key })
    });
    saveSession(json.data.access_token, json.data.user);
    setToken(json.data.access_token);
    setUser(json.data.user);
    setStatus("프로필 사진을 계정에 저장했습니다.");
  }

  if (!user) {
    return (
      <section className="panel empty-state">
        <KeyRound size={28} />
        <h1 className="panel-title">로그인이 필요합니다</h1>
        <p className="muted">내 정보는 로그인 후 확인할 수 있습니다.</p>
        <a className="button" href="/login">로그인으로 이동</a>
      </section>
    );
  }

  return (
    <div className="reference-page mypage-account-page">
      <header className="page-heading-row">
        <div>
          <h1 className="page-title">내 정보</h1>
          <p className="muted">계정 정보만 확인하고 프로필 사진을 변경합니다.</p>
        </div>
        <button className="filter-button" type="button" onClick={() => refreshMe().catch((error) => setStatus(error.message))}>
          <RefreshCw size={16} />
          새로고침
        </button>
      </header>

      <section className="mypage-account-layout">
        <article className="panel mypage-account-card">
          <div className="panel-header">
            <h2 className="panel-title">계정 정보</h2>
            <UserRound size={20} />
          </div>
          <div className="profile-editor">
            <span className="profile-avatar-large">
              {user.avatar_url ? <img src={user.avatar_url} alt="" /> : <UserRound size={30} />}
            </span>
            <label className="filter-button">
              <ImagePlus size={16} />
              프로필 사진 변경
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  changeAvatar(event.target.files?.[0] ?? null).catch((error) =>
                    setStatus(error instanceof Error ? error.message : "프로필 사진 저장 실패")
                  )
                }
              />
            </label>
          </div>
          <dl className="info-list">
            <div><dt>이름</dt><dd>{user.name}</dd></div>
            <div><dt>이메일</dt><dd><Mail size={15} /> {user.email}</dd></div>
            <div><dt>역할</dt><dd><ShieldCheck size={15} /> {roleLabel(user.role)}</dd></div>
            <div><dt>회사</dt><dd><Building2 size={15} /> {user.company_name ?? user.company_id}</dd></div>
          </dl>
          {status ? <p className="muted">{status}</p> : null}
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
