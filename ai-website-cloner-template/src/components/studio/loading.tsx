"use client";
import { EditorSkeleton } from "./generation-feedback";

import { Header } from "@/components/sites/storyplay/shared";
import { StudioNav } from "./navigation";

export function StudioLoading() {
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav /><main className="plotloom-main" aria-busy="true"><EditorSkeleton /></main></div></div>;
}
