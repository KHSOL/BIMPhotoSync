import "./globals.css";
import type { Metadata } from "next";
import { Bell, Box, Building2, Camera, Folder, Home, ImageIcon, Settings } from "lucide-react";

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
            <div className="brand">
              <div className="brand-mark">
                <Box size={18} />
              </div>
              BIM Photo Sync
            </div>
            <nav className="nav">
              <a>Company</a>
              <a className="active">Project</a>
              <a>Viewer</a>
              <a>Reports</a>
              <a>Audit</a>
            </nav>
            <Bell size={18} color="#334155" />
          </header>
          <div className="layout">
            <aside className="sidebar">
              <a className="side-link">
                <Home size={16} /> Dashboard
              </a>
              <a className="side-link" href="/rooms">
                <Building2 size={16} /> Rooms
              </a>
              <a className="side-link active" href="/photos">
                <ImageIcon size={16} /> Photos
              </a>
              <a className="side-link">
                <Folder size={16} /> Reports
              </a>
              <a className="side-link">
                <Camera size={16} /> Revit Sync
              </a>
              <a className="side-link">
                <Settings size={16} /> Settings
              </a>
            </aside>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

