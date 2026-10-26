import { StudioEditor } from "@/components/studio/editor";
export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string; reference?: string }> }) {
  const query = await searchParams;
  return <StudioEditor key={`short_drama:${query.mode || ""}:${query.reference || ""}`} kind="short_drama" mode={query.mode} referenceId={query.reference} />;
}
