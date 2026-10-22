import { Suspense } from "react";
import { Workspace } from "@/components/sites/storyplay/workspace";

export default function WorkspacePage() {
  return <Suspense fallback={<main className="loading-page">正在打开创作空间……</main>}><Workspace /></Suspense>;
}
