"use client";

import { Building2, FileText, Home, Images, Layers, LogIn, LogOut, MapPinned, Settings, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { canAccessAdminBoards, clearSession, isSuperAdmin, readSession, userInitials, type User } from "./client";

const navItems = [
  { href: "/dashboard", label: "대시보드", icon: Home },
  { href: "/projects", label: "프로젝트", icon: Building2 },
  { href: "/rooms", label: "실 목록", icon: MapPinned },
  { href: "/photos", label: "사진", icon: Images },
  { href: "/reports", label: "보고서", icon: FileText, managerOnly: true },
  { href: "/viewer", label: "평면도", icon: Layers },
  { href: "/sheets", label: "시트", icon: FileText },
  { href: "/audit", label: "감사", icon: ShieldCheck, managerOnly: true },
  { href: "/mypage", label: "내 정보", icon: Settings },
  { href: "/admin", label: "전체 관리", icon: ShieldCheck, superOnly: true }
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const isAuthPage = pathname === "/login";

  useEffect(() => {
    const syncUser = () => setUser(readSession()?.user ?? null);
    syncUser();
    window.addEventListener("bps_session_changed", syncUser);
    return () => window.removeEventListener("bps_session_changed", syncUser);
  }, [pathname]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  function logout() {
    clearSession();
    setUser(null);
    router.push("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="sidebar-brand" href="/dashboard" aria-label="BIM Photo Sync 홈">
          <img src="/auth/app-logo-mark.png" alt="" />
          <span>BIM Photo Sync</span>
        </a>

        <nav className="sidebar-nav" aria-label="주요 내비게이션">
          {navItems
            .filter((item) => !item.superOnly || isSuperAdmin(user))
            .filter((item) => !item.managerOnly || canAccessAdminBoards(user))
            .map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <a key={item.href} className={active ? "active" : ""} href={item.href} title={item.label}>
                  <Icon size={20} />
                  <span>{item.label}</span>
                </a>
              );
            })}
        </nav>

        <div className="sidebar-footer">
          {user ? (
            <>
              <div className="sidebar-user" title={`${user.name} / ${roleLabel(user.role)} / ${user.company_name ?? ""}`}>
                <span className="sidebar-avatar" aria-hidden="true">
                  {user.avatar_url ? <img src={user.avatar_url} alt="" /> : userInitials(user.name)}
                </span>
                <strong>{user.name}</strong>
                <span>{roleLabel(user.role)}</span>
                <span>{user.company_name ?? "회사 정보 없음"}</span>
              </div>
              <button className="sidebar-auth-button" type="button" onClick={logout} aria-label="로그아웃" title="로그아웃">
                <LogOut size={19} />
                <span>로그아웃</span>
              </button>
            </>
          ) : (
            <a className="sidebar-auth-button" href="/login" aria-label="로그인" title="로그인">
              <LogIn size={19} />
              <span>로그인</span>
            </a>
          )}
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}

function roleLabel(role: string) {
  if (role === "SUPER_ADMIN") return "최고관리자";
  if (role === "COMPANY_ADMIN" || role === "PROJECT_ADMIN" || role === "BIM_MANAGER") return "상위 관리자";
  if (role === "MANAGER") return "관리자";
  return "일반 사용자";
}
