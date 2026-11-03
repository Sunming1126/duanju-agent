import { serverI18n } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SampleReader } from "@/components/studio/sample-reader";
import { officialSamples, getOfficialSample } from "@/content/samples";

export function generateStaticParams() { return officialSamples.map(sample => ({ slug: sample.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { ui, preferences } = await serverI18n();
  const sample = getOfficialSample(slug, undefined, preferences.locale);
  return sample ? { title: `${sample.work.title} · ${ui("官方样例")}`, description: sample.logline } : { title: ui("未找到样例") };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { preferences } = await serverI18n();
  const sample = getOfficialSample(slug, undefined, preferences.locale);
  if (!sample) notFound();
  return <SampleReader sample={sample} />;
}
