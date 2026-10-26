import { getOfficialSample, sampleDocument } from "@/content/samples";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sample = getOfficialSample(slug);
  if (!sample) return new Response("未找到样例", { status: 404 });
  const filename = encodeURIComponent(`Plotloom官方样例-${sample.work.title}.txt`);
  return new Response(`\uFEFF${sampleDocument(sample)}`, { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="plotloom-${sample.slug}.txt"; filename*=UTF-8''${filename}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=300",
  } });
}
