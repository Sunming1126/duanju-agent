import { getOfficialSample, sampleDocument } from "@/content/samples";
import { serverI18n } from "@/lib/i18n/server";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { preferences, ui } = await serverI18n();
  const sample = getOfficialSample(slug, undefined, preferences.locale);
  if (!sample) return new Response(ui("未找到样例"), { status: 404 });
  const filename = encodeURIComponent(sample.work.output_locale === "zh-CN" ? `Plotloom官方样例-${sample.work.title}.txt` : `Plotloom-${sample.slug}.txt`);
  return new Response(`\uFEFF${sampleDocument(sample)}`, { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="plotloom-${sample.slug}.txt"; filename*=UTF-8''${filename}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Vary": "Cookie",
  } });
}
