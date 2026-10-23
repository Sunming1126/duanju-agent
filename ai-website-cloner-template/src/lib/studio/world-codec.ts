/**
 * Adapted from StoryForge (MIT), yuanbw2025, commit
 * c5a1cab7d7d02eb4382d13ecb9b3de2785037d88, release-hash.ts.
 * Only the pure canonical JSON algorithm is reused. Dexie transaction handling
 * is intentionally omitted: our world drafts are saved by the local backend.
 * This is not StoryForge's WorldRelease interchange protocol.
 */
export function canonicalWorldReleaseJsonV1(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalWorldReleaseJsonV1).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalWorldReleaseJsonV1(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export async function worldDraftChecksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalWorldReleaseJsonV1(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
