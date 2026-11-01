import { serverI18n } from "@/lib/i18n/server";

import { Suspense } from "react";
import { DramaLibrary } from "@/components/sites/storyplay/library";

export default async function ConceptsPage() {
  const { ui } = await serverI18n();
  return (
    <Suspense
      fallback={<main className="loading-page">{ui("正在打开故事灵感……")}</main>}
    >
      <DramaLibrary />
    </Suspense>
  );
}
