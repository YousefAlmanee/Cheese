import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, user } from "@/db/schema";
import { addEntry, upsertItem } from "@/lib/library";
import type { ItemDraft } from "@/lib/providers/types";

type Seed = {
  draft: Partial<ItemDraft> & Pick<ItemDraft, "category" | "title" | "unit" | "totalUnits" | "unitSeconds">;
  ext: string;
  patch?: Partial<typeof entry.$inferInsert>;
};

const d = (category: ItemDraft["category"], title: string, unit: ItemDraft["unit"], totalUnits: number | null, unitSeconds: number | null, extra: Partial<ItemDraft> = {}) => ({
  category, title, creator: null, unit, totalUnits, unitSeconds, ...extra,
});

/** A believable library for screenshots and tests. Returns entries by title. */
export async function seedDemo(userId: string) {
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000);
  const list: Seed[] = [
    { ext: "154587", draft: d("anime", "Frieren", "episode", 28, 1440, { creator: "MADHOUSE", genres: ["Fantasy", "Adventure"], year: 2023 }), patch: { status: "in_progress", progress: 7, priority: "must", together: true, startedAt: ago(200), lastProgressAt: ago(5) } },
    { ext: "OL893415W", draft: d("book", "Dune", "page", 604, null, { creator: "Frank Herbert", genres: ["Science fiction"], year: 1965 }), patch: { status: "in_progress", progress: 120, lastProgressAt: ago(30) } },
    { ext: "119133", draft: d("game", "Elden Ring", "minute", 3300, 60, { creator: "FromSoftware", platforms: ["PC (Microsoft Windows)", "PlayStation 5"], genres: ["RPG"], year: 2022 }), patch: { status: "in_progress", progress: 840, platform: "PlayStation 5", lastProgressAt: ago(52) } },
    { ext: "tv/95396", draft: d("series", "Severance", "episode", 19, 3000, { creator: "Dan Erickson", genres: ["Drama", "Thriller"], year: 2022 }), patch: { status: "in_progress", progress: 11, lastProgressAt: ago(80) } },
    { ext: "30013", draft: d("manga", "Vinland Saga", "chapter", null, null, { creator: "Makoto Yukimura", genres: ["Action", "Historical"], year: 2005 }), patch: { status: "in_progress", progress: 54, lastProgressAt: ago(120) } },
    { ext: "movie/157336", draft: d("movie", "Interstellar", "watch", 1, 169 * 60, { creator: "Christopher Nolan", genres: ["Science Fiction", "Drama"], year: 2014 }), patch: { status: "want", priority: "must", together: true } },
    { ext: "movie/976893", draft: d("movie", "Perfect Days", "watch", 1, 124 * 60, { creator: "Wim Wenders", genres: ["Drama"], year: 2023 }), patch: { status: "want", together: true } },
    { ext: "30002", draft: d("manga", "Berserk", "chapter", 364, null, { creator: "Kentaro Miura", genres: ["Action", "Fantasy"], year: 1989 }), patch: { status: "want" } },
    { ext: "126459", draft: d("game", "It Takes Two", "minute", 720, 60, { creator: "Hazelight", platforms: ["PC (Microsoft Windows)", "PlayStation 5"], genres: ["Adventure"], year: 2021 }), patch: { status: "want", together: true } },
    { ext: "tv/157741", draft: d("series", "Dune: Prophecy", "episode", 6, 3480, { creator: "Alison Schapker", genres: ["Science Fiction"], year: 2024 }), patch: { status: "want", together: true } },
    { ext: "movie/129", draft: d("movie", "Spirited Away", "watch", 1, 125 * 60, { creator: "Hayao Miyazaki", genres: ["Animation", "Fantasy"], year: 2001 }), patch: { status: "done", progress: 1, ratingHalf: 10, wouldRedo: true, together: true, finishedAt: ago(500) } },
    { ext: "113112", draft: d("game", "Hades", "minute", 1320, 60, { creator: "Supergiant Games", genres: ["Roguelike"], year: 2020 }), patch: { status: "done", progress: 1320, ratingHalf: 9, finishedAt: ago(900) } },
  ];
  const out: Record<string, typeof entry.$inferSelect> = {};
  for (const s of list) {
    const category = s.draft.category;
    const source = category === "movie" || category === "series" ? "tmdb" : category === "anime" || category === "manga" ? "anilist" : category === "book" ? "openlibrary" : "igdb";
    const row = await upsertItem({ source, externalId: s.ext, coverUrl: null, summary: null, genres: [], platforms: [], year: null, ...s.draft } as ItemDraft);
    const { entry: e } = await addEntry(userId, row.id);
    const [updated] = await db.update(entry).set(s.patch ?? {}).where(eq(entry.id, e.id)).returning();
    out[s.draft.title] = updated;
  }
  return out;
}

export async function userIdByName(name: string) {
  const [u] = await db.select().from(user).where(eq(user.username, name.toLowerCase()));
  return u.id;
}
