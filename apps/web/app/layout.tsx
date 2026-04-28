import "./globals.css";
import type { Metadata } from "next";
import Shell from "./shell";

export const metadata: Metadata = {
  title: "BIM Photo Sync",
  description: "Room-centered construction photo operations"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
