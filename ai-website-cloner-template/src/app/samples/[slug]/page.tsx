import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SampleReader } from "@/components/studio/sample-reader";
import { officialSamples, getOfficialSample } from "@/content/samples";

export function generateStaticParams() { return officialSamples.map(sample => ({ slug: sample.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sample = getOfficialSample(slug);
  return sample ? { title: `${sample.work.title} · 官方${sample.work.content_type === "novel" ? "小说" : "剧本"}样例`, description: sample.logline } : { title: "未找到样例" };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sample = getOfficialSample(slug);
  if (!sample) notFound();
  return <SampleReader sample={sample} />;
}
