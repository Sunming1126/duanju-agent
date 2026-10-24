import { StudioEditor } from "@/components/studio/editor";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StudioEditor id={(await params).id} />;
}
