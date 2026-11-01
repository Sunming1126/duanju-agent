"use client";
import { useUI } from "@/lib/i18n/provider";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const ui = useUI();
  return <main className="loading-page"><h1>{ui("页面暂时无法显示")}</h1><p>{ui("请重新加载或返回作品库，继续查看已保存内容。")}</p><button className="pill light" onClick={reset}>{ui("重新加载")}</button><a href="/workspace">{ui("返回作品库")}</a></main>;
}
