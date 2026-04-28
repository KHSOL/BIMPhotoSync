"use client";

import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  User
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { apiJson, saveSession, type User as SessionUser } from "../client";

type AuthMode = "login" | "register";

type AuthResult = {
  data: {
    access_token: string;
    user: SessionUser;
  };
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";
  const passwordReady = useMemo(() => password.length >= 8, [password]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setStatus("");
    setPassword("");
    setPasswordConfirm("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (isRegister) {
      if (!companyName.trim() || !name.trim()) {
        setStatus("회사명과 이름을 입력해주세요.");
        return;
      }
      if (!passwordReady) {
        setStatus("비밀번호는 8자 이상으로 입력해주세요.");
        return;
      }
      if (password !== passwordConfirm) {
        setStatus("비밀번호 확인이 일치하지 않습니다.");
        return;
      }
    }

    setLoading(true);
    try {
      const body = isRegister
        ? {
            email: email.trim(),
            password,
            name: name.trim(),
            company_name: companyName.trim()
          }
        : { email: email.trim(), password };
      const json = await apiJson<AuthResult>(isRegister ? "/auth/register" : "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      saveSession(json.data.access_token, json.data.user);
      router.push("/projects");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card-v2">
        <div className="auth-visual">
          <img src="/auth/loginpageimg.png" alt="" />
        </div>

        <div className="auth-form-side">
          <div className="auth-form-wrap">
            <div className="auth-switch-line">
              <span>{isRegister ? "이미 계정이 있으신가요?" : "계정이 없으신가요?"}</span>
              <button type="button" onClick={() => switchMode(isRegister ? "login" : "register")}>
                {isRegister ? "로그인" : "회원가입"}
              </button>
            </div>

            <div className="auth-title-block">
              <h1>{isRegister ? "회원가입" : "로그인"}</h1>
              <p>
                {isRegister
                  ? "회사 단위로 현장 사진과 Room 데이터를 안전하게 분리해 관리합니다."
                  : "BIM Photo Sync에 접속하여 현장 사진과 Room 정보를 확인하세요."}
              </p>
            </div>

            <form className="auth-form-v2" onSubmit={submit}>
              {isRegister ? (
                <>
                  <AuthField icon={<Building2 size={19} />} label="회사명">
                    <input
                      autoComplete="organization"
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      placeholder="회사명을 입력하세요"
                      required
                    />
                  </AuthField>
                  <AuthField icon={<User size={19} />} label="이름">
                    <input
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="이름을 입력하세요"
                      required
                    />
                  </AuthField>
                </>
              ) : null}

              <AuthField icon={<Mail size={19} />} label="이메일">
                <input
                  autoComplete="email"
                  inputMode="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="이메일을 입력하세요"
                  required
                />
              </AuthField>

              <AuthField icon={<LockKeyhole size={19} />} label="비밀번호">
                <div className="auth-password-control">
                  <input
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="비밀번호를 입력하세요"
                    required
                  />
                  <button
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </AuthField>

              {isRegister ? (
                <>
                  <AuthField icon={<LockKeyhole size={19} />} label="비밀번호 확인">
                    <input
                      autoComplete="new-password"
                      type={showPassword ? "text" : "password"}
                      value={passwordConfirm}
                      onChange={(event) => setPasswordConfirm(event.target.value)}
                      placeholder="비밀번호를 한 번 더 입력하세요"
                      required
                    />
                  </AuthField>

                  <div className={passwordReady ? "auth-rule ready" : "auth-rule"}>
                    <CheckCircle2 size={18} />
                    <span>비밀번호 8자 이상</span>
                  </div>
                </>
              ) : null}

              {status ? <p className="auth-status">{status}</p> : null}

              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? <Loader2 className="spin" size={20} /> : null}
                {isRegister ? "가입하고 시작하기" : "로그인"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthField({
  icon,
  label,
  children
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="auth-field-v2">
      <span className="auth-field-label">{label}</span>
      <span className="auth-field-box">
        <span className="auth-field-icon">{icon}</span>
        {children}
      </span>
    </label>
  );
}
