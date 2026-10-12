import type { Category, Source } from "@/db/schema";

/** Where a title from search or the Popular shelves can be opened without adding it. Null for things typed in by hand. */
export function discoverHref(h: { source: Source; externalId: string | null; category: Category }): string | null {
  if (h.source === "manual" || !h.externalId) return null;
  const q = new URLSearchParams({ source: h.source, id: h.externalId, c: h.category });
  return `/discover?${q.toString()}`;
}

/** The "I already did it" button reads differently for each kind of thing. */
export const DONE_LABEL: Record<Category, string> = {
  movie: "Watched it",
  series: "Watched it",
  anime: "Watched it",
  manga: "Read it",
  book: "Read it",
  game: "Played it",
};
