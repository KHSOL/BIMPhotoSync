import "./globals.css";
import type { Metadata } from "next";
import Shell from "./shell";

export const metadata: Metadata = {
  title: "BIM Photo Sync",
  description: "Room-centered construction photo operations",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "BIM Photo Sync",
    description: "Room-centered construction photo operations",
    images: [
      {
        url: "/OGimg.png",
        width: 1200,
        height: 630,
        alt: "BIM Photo Sync"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "BIM Photo Sync",
    description: "Room-centered construction photo operations",
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
