import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoryPlay · 短剧剧本创作平台 · 前端预览",
  description: "StoryPlay 公开首页的本地复刻与创作交互原型。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
