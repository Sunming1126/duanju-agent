import { redirect } from "next/navigation";
import { StudioWorkspace } from "@/components/studio/workspace";
export default async function Page({ searchParams }: { searchParams: Promise<{ create?: string; reference?: string; work?: string; id?: string }> }) {
  const q = await searchParams;
  if (q.work || q.id) redirect(`/studio/works/${encodeURIComponent(q.work || q.id || "")}`);
  if (q.create) {
    const names: Record<string, string> = { adapt: "小说改编", rewrite: "剧本改写", inspiration: "灵感策划" };
    const query = new URLSearchParams();
    if (q.reference) query.set("reference", q.reference);
    if (names[q.create]) query.set("mode", names[q.create]);
    redirect(`/studio/${q.create === "novel" ? "novels" : "scripts"}/new?${query}`);
  }
  return <StudioWorkspace />;
}
