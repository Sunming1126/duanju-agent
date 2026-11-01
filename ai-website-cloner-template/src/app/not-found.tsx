import Link from "next/link";
import { serverI18n } from "@/lib/i18n/server";
import { Header } from "@/components/sites/storyplay/shared";
export default async function NotFound() {
  const { ui } = await serverI18n();
  return <div className="workspace-page"><Header /><main className="loading-page"><h1>{ui("页面未找到")}</h1><p>{ui("内容不存在或当前账号无权访问。")}</p><Link className="pill light" href="/">{ui("返回首页")}</Link></main></div>;
}
