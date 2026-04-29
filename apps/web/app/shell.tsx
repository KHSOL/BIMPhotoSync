"use client";

import { Box, Building2, FileText, Home, Images, LogIn, LogOut, MapPinned, Settings, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSession, isSuperAdmin, readSession, type User } from "./client";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/projects", label: "Projects", icon: Building2 },
  { href: "/rooms", label: "Rooms", icon: MapPinned },
  { href: "/photos", label: "Photos", icon: Images },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/viewer", label: "Viewer", icon: Box },
  { href: "/audit", label: "Audit", icon: ShieldCheck },
  { href: "/mypage", label: "My Page", icon: Settings },
  { href: "/admin", label: "Admin", icon: ShieldCheck, superOnly: true }
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const isAuthPage = pathname === "/login";

  useEffect(() => {
    setUser(readSession()?.user ?? null);
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
        <a className="sidebar-brand" href="/dashboard" aria-label="BIM Photo Sync Home">
          <img src="/auth/app-logo-mark.png" alt="" />
          <span>BIM Photo Sync</span>
        </a>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems
            .filter((item) => !item.superOnly || isSuperAdmin(user))
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
                <strong>{user.name}</strong>
                <span>{roleLabel(user.role)}</span>
                <span>{user.company_name ?? "Company not loaded"}</span>
              </div>
              <button className="sidebar-auth-button" type="button" onClick={logout} aria-label="로그아웃" title="Logout">
                <LogOut size={19} />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <a className="sidebar-auth-button" href="/login" aria-label="로그인" title="Login">
              <LogIn size={19} />
              <span>Login</span>
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
