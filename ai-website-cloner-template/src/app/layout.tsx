import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Plotloom · 短剧与小说创作平台",
    template: "%s · Plotloom",
  },
  description: "Plotloom 短剧与小说创作平台，从灵感、世界设定到故事正文，让创作逐步成形。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
