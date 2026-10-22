import { Suspense } from "react";
import { DramaLibrary } from "@/components/sites/storyplay/library";

export default function LapianPage() {
  return <Suspense fallback={<main className="loading-page">正在打开短剧拉片……</main>}><DramaLibrary /></Suspense>;
}
