import "./globals.css";
import type { Metadata } from "next";
import { Bell, Box, Building2, Camera, ChevronDown, Home, ImageIcon, Settings } from "lucide-react";

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
                <Box size={20} />
              </div>
              BIM Photo Sync
            </div>
            <nav className="nav">
              <a>Company</a>
              <a className="active">Project</a>
              <a>Photos</a>
              <a>AI Queue</a>
              <a>Audit</a>
            </nav>
            <div className="user-menu">
              <Bell size={18} />
              <div className="avatar">JS</div>
              <span>User</span>
              <ChevronDown size={16} />
            </div>
          </header>
          <div className="layout">
            <aside className="sidebar">
              <a className="side-link" href="/photos">
                <Home size={18} /> Dashboard
              </a>
              <a className="side-link" href="/rooms">
                <Building2 size={18} /> Rooms
              </a>
              <a className="side-link active" href="/photos">
                <ImageIcon size={18} /> Photos
              </a>
              <a className="side-link disabled">
                <Camera size={18} /> Revit Sync
              </a>
              <a className="side-link disabled">
                <Settings size={18} /> Settings
              </a>
            </aside>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
