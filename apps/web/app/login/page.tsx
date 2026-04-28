"use client";

import { Building2, KeyRound, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiJson, saveSession, User } from "../client";

type AuthResult = {
  data: {
    access_token: string;
    user: User;
  };
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("dev@bim.local");
  const [password, setPassword] = useState("password123");
  const [name, setName] = useState("Dev User");
  const [companyName, setCompanyName] = useState("BIM Photo Sync");
  const [status, setStatus] = useState("회사 단위로 데이터가 분리됩니다.");

  async function submit() {
    const path = mode === "login" ? "/auth/login" : "/auth/register";
    const body =
      mode === "login"
        ? { email, password }
        : { email, password, name, company_name: companyName };
    const json = await apiJson<AuthResult>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    saveSession(json.data.access_token, json.data.user);
    setStatus(`${json.data.user.name} 계정으로 로그인했습니다.`);
    router.push("/projects");
  }

  return (
    <>
      <div className="breadcrumb">
        <span>Company</span>
        <span>/</span>
        <strong>Login</strong>
      </div>

      <section className="auth-grid">
        <div className="panel auth-panel">
          <div className="panel-header">
            <div>
              <h1 className="page-title">로그인 / 가입</h1>
              <p className="muted">작업자, 관리자, BIM 담당자가 같은 API와 DB를 사용합니다.</p>
            </div>
            <span className="badge blue">
              <KeyRound size={13} /> JWT
            </span>
          </div>

          <div className="segmented">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">
              <LogIn size={16} /> 로그인
            </button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">
              <UserPlus size={16} /> 가입
            </button>
          </div>

          <div className="form-grid">
            <Field label="Email">
              <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            <Field label="Password">
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {mode === "register" ? (
              <>
                <Field label="Name">
                  <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label="Company">
                  <input
                    className="input"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                  />
                </Field>
              </>
            ) : null}
          </div>

          <div className="actions">
            <button className="button" onClick={() => submit().catch((err) => setStatus(err.message))} type="button">
              <KeyRound size={16} /> {mode === "login" ? "로그인" : "가입하고 시작"}
            </button>
          </div>
          <p className="muted">{status}</p>
        </div>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="panel-title">권한 기준</h2>
            <Building2 size={18} color="#2563eb" />
          </div>
          <div className="role-list">
            <Role name="Worker" body="촬영, Room 선택, 공종/공사면 입력, 업로드" />
            <Role name="Manager" body="AI 결과 검토, 상태 관리" />
            <Role name="Project Admin" body="프로젝트 운영과 접근키 관리" />
            <Role name="BIM Manager" body="Revit 연결, Room Sync, Add-in 검증" />
            <Role name="Company Admin" body="회사 단위 프로젝트와 보안 기준 관리" />
          </div>
        </aside>
      </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Role({ name, body }: { name: string; body: string }) {
  return (
    <div className="role-card">
      <strong>{name}</strong>
      <span>{body}</span>
    </div>
  );
}
