"use client";

import { Box } from "lucide-react";
import { usePathname } from "next/navigation";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login";

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/photos">
          <div className="brand-mark">
            <Box size={20} />
          </div>
          BIM Photo Sync
        </a>
        <nav className="nav">
          <a href="/projects">Projects</a>
          <a href="/rooms">Rooms</a>
          <a href="/photos">Photos</a>
          <a href="/login">Login</a>
        </nav>
      </header>
      <div className="layout">
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
