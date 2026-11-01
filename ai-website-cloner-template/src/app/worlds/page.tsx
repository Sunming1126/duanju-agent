import { serverI18n } from "@/lib/i18n/server";
import { WorldWorkspace } from "@/components/studio/worlds";

const pageMetadata = { title: "世界设定 · 本地创作" };
export default function WorldsPage() {
  return <WorldWorkspace />;
}

export async function generateMetadata() { const { ui } = await serverI18n(); return { ...pageMetadata, title: ui(pageMetadata.title) }; }
