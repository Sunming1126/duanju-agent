import { notFound } from "next/navigation";
import { CreationPreview } from "@/components/sites/storyplay-creation/preview";

export default async function Layout({ children, params }: {
  children: React.ReactNode; params: Promise<{ id: string }>;
}) {
  if (process.env.NODE_ENV !== "development" && process.env.PLOTLOOM_ENABLE_REFERENCE_PREVIEW !== "1") notFound();
  const { id } = await params;
  return <CreationPreview id={id}>{children}</CreationPreview>;
}
