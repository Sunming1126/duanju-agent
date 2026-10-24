import { Suspense } from "react";
import { DramaLibrary } from "@/components/sites/storyplay/library";

export default function ConceptsPage() {
  return (
    <Suspense
      fallback={<main className="loading-page">正在打开故事灵感……</main>}
    >
      <DramaLibrary />
    </Suspense>
  );
}
