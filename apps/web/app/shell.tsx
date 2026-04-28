"use client";

import { FolderKanban, Images, LogIn, LogOut, MapPinned } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSession, readSession, type User } from "./client";

const navItems = [
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/rooms", label: "Rooms", icon: MapPinned },
  { href: "/photos", label: "Photos", icon: Images }
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
        <a className="sidebar-brand" href="/projects" aria-label="BIM Photo Sync Home">
          <img src="/auth/app-logo-mark.png" alt="" />
          <span>BIM Photo Sync</span>
        </a>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <a key={item.href} className={active ? "active" : ""} href={item.href}>
                <Icon size={20} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {user ? (
            <>
              <div className="sidebar-user">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <button className="sidebar-auth-button" type="button" onClick={logout}>
                <LogOut size={19} />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <a className="sidebar-auth-button" href="/login">
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
