import { serverI18n } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { SampleLibrary } from "@/components/studio/sample-library";

const pageMetadata: Metadata = { title: "官方小说与剧本样例", description: "免费阅读与下载 Plotloom 官方原创小说、短剧示范，了解故事设定、人物、大纲与完整正文。" };

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  return <SampleLibrary kind={type === "novel" || type === "short_drama" ? type : undefined} />;
}

export async function generateMetadata() { const { ui } = await serverI18n(); return { ...pageMetadata, title: ui(pageMetadata.title), description: ui(pageMetadata.description) }; }
