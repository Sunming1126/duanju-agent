import type { WorkSummary } from "./api";

export type LibraryState = "all" | "active" | "archived";
export type LibrarySort = "updated" | "created" | "title";

// Keep only the last lightweight list in memory. Every return still revalidates.
let snapshot: WorkSummary[] | undefined;
export function librarySnapshot() { return snapshot; }
export function rememberLibrary(items: WorkSummary[]) { snapshot = items; }

export function visibleWorks(items: WorkSummary[], query: string, kind: string, state: LibraryState, sort: LibrarySort) {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(work => (!kind || work.content_type === kind)
    && (state === "all" || work.archived === (state === "archived"))
    && work.title.toLocaleLowerCase().includes(search))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN")
      : (sort === "created" ? b.created_at - a.created_at : b.updated_at - a.updated_at) || a.id.localeCompare(b.id));
}
