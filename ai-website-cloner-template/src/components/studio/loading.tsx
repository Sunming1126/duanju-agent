"use client";
import { useUI } from "@/lib/i18n/provider";

import { Header } from "@/components/sites/storyplay/shared";
import { StudioNav } from "./navigation";

export function StudioLoading() {
  const ui = useUI();
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav /><main className="plotloom-main" aria-busy="true"><div className="studio-loading" role="status"><p>{ui("正在打开创作空间…")}</p><div /><div /><div /></div></main></div></div>;
}
