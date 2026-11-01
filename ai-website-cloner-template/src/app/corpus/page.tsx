import { serverI18n } from "@/lib/i18n/server";
import { CorpusWorkspace } from "@/components/studio/corpus";

const pageMetadata = { title: "中文语料参考 · 本地创作" };
export default function CorpusPage() {
  return <CorpusWorkspace />;
}

export async function generateMetadata() { const { ui } = await serverI18n(); return { ...pageMetadata, title: ui(pageMetadata.title) }; }
