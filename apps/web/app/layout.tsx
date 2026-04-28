import "./globals.css";
import type { Metadata } from "next";
import { Box } from "lucide-react";

export const metadata: Metadata = {
  title: "BIM Photo Sync",
  description: "Room-centered construction photo operations"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
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
      </body>
    </html>
  );
}
