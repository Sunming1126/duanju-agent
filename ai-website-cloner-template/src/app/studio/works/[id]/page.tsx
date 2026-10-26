import { StudioEditor } from "@/components/studio/editor";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudioEditor key={id} id={id} />;
}
