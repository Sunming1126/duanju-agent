import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "四步创作 · 界面预览", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!["1", "2", "3", "4"].includes(step)) notFound();
  return null;
}
