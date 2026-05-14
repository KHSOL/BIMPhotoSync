import "./globals.css";
import type { Metadata } from "next";
import Shell from "./shell";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export const metadata: Metadata = {
  title: "BIM Photo Sync",
  description: "실 기준 현장 사진 관리",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "BIM Photo Sync",
    description: "실 기준 현장 사진 관리",
    type: "website",
    images: [
      {
        url: "/OGimg.png",
        width: 1200,
        height: 630,
        type: "image/png",
        alt: "BIM Photo Sync"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "BIM Photo Sync",
    description: "실 기준 현장 사진 관리",
    images: ["/OGimg.png"]
  }
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
