import "./globals.css";
import type { Metadata } from "next";
import { Bell, Box, Building2, Camera, ChevronDown, Home, ImageIcon, KeyRound, Settings } from "lucide-react";

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
              <a href="/projects">Company</a>
              <a href="/projects" className="active">
                Project
              </a>
              <a href="/rooms">Rooms</a>
              <a href="/photos">Photos</a>
              <a href="/login">Login</a>
            </nav>
            <div className="user-menu">
              <Bell size={18} />
              <div className="avatar">BP</div>
              <span>Workspace</span>
              <ChevronDown size={16} />
            </div>
          </header>
          <div className="layout">
            <aside className="sidebar">
              <a className="side-link" href="/projects">
                <Home size={18} /> Projects
              </a>
              <a className="side-link" href="/rooms">
                <Building2 size={18} /> Rooms
              </a>
              <a className="side-link active" href="/photos">
                <ImageIcon size={18} /> Photos
              </a>
              <a className="side-link" href="/login">
                <KeyRound size={18} /> Login
              </a>
              <span className="side-link disabled">
                <Camera size={18} /> Revit Sync
              </span>
              <span className="side-link disabled">
                <Settings size={18} /> Settings
              </span>
            </aside>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
