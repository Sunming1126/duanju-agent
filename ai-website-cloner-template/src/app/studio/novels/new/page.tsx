import { StudioEditor } from "@/components/studio/editor";
import { notFound } from "next/navigation";
import { getOfficialSample, sampleCreationInput } from "@/content/samples";

export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string; reference?: string; sample?: string }> }) {
  const query = await searchParams;
  const sample = query.sample ? getOfficialSample(query.sample, "novel") : undefined;
  if (query.sample && (!sample || query.reference)) notFound();
  return <StudioEditor key={`novel:${query.mode || ""}:${query.reference || ""}:${query.sample || ""}`} kind="novel" mode={sample ? undefined : query.mode} referenceId={query.reference} sampleId={sample?.slug} sampleInput={sample ? sampleCreationInput(sample) : undefined} />;
}
