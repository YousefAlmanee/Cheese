import type { Category, Unit } from "@/db/schema";

/** Typical seconds per unit when a source does not say. Estimates, always shown with "about". */
export const DEFAULT_UNIT_SECONDS: Record<Unit, number> = {
  watch: 110 * 60,
  episode: 24 * 60,
  chapter: 8 * 60,
  page: 90,
  minute: 60,
};

export const UNIT_FOR_CATEGORY: Record<Category, Unit> = {
  movie: "watch",
  series: "episode",
  anime: "episode",
  manga: "chapter",
  book: "page",
  game: "minute",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  movie: "Movie",
  series: "Series",
  anime: "Anime",
  manga: "Manga",
  book: "Book",
  game: "Game",
};

export const CATEGORY_PLURAL: Record<Category, string> = {
  movie: "Movies",
  series: "Series",
  anime: "Anime",
  manga: "Manga",
  book: "Books",
  game: "Games",
};

export type Sized = { unit: Unit; totalUnits: number | null; unitSeconds: number | null };

export function unitSeconds(item: Pick<Sized, "unit" | "unitSeconds">): number {
  return item.unitSeconds ?? DEFAULT_UNIT_SECONDS[item.unit];
}

/** Total length in minutes, or null when the number of units is unknown. */
export function totalMinutes(item: Sized, totalOverride?: number | null): number | null {
  const total = totalOverride ?? item.totalUnits;
  if (total == null) return null;
  return Math.round((total * unitSeconds(item)) / 60);
}

/** Minutes left given progress in units, or null when the length is unknown. Never negative. */
export function remainingMinutes(item: Sized, progress: number, totalOverride?: number | null): number | null {
  const total = totalOverride ?? item.totalUnits;
  if (total == null) return null;
  return Math.max(0, Math.round(((total - progress) * unitSeconds(item)) / 60));
}

/** Compact duration: 45m, 2h, 2h 49m. */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** "155 min", "24 episodes · 25 min each", "320 pages" and so on, or null when the size is not known. */
export function lengthLine(it: { unit: string; totalUnits: number | null; unitSeconds: number | null }, override: number | null) {
  const total = override ?? it.totalUnits;
  if (total == null) return null;
  const mins = totalMinutes(it as Parameters<typeof totalMinutes>[0], override);
  switch (it.unit) {
    case "watch":
      return mins ? formatMinutes(mins) : null;
    case "episode":
      return `${total} episodes${it.unitSeconds ? ` · ${Math.round(it.unitSeconds / 60)} min each` : ""}`;
    case "chapter":
      return `${total} chapters`;
    case "page":
      return `${total} pages`;
    case "minute":
      return `About ${formatMinutes(total)} to finish`;
    default:
      return null;
  }
}
