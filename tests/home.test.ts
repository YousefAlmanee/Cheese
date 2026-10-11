import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { loadHome } from "@/lib/home";
import { addEntry, upsertItem } from "@/lib/library";
import { bookSession } from "@/lib/sessions";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-16T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3600_000);

describe("loadHome up next", () => {
  it("uses the next session for an item, even when a plain session comes first", async () => {
    const me = await makeUser("Yousef");
    const film = await upsertItem({ category: "movie", source: "tmdb", externalId: "movie/1", title: "Interstellar", creator: null, year: null, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 169 * 60, genres: [], platforms: [] });
    const show = await upsertItem({ category: "anime", source: "anilist", externalId: "1", title: "Frieren", creator: null, year: null, coverUrl: null, summary: null, unit: "episode", totalUnits: 28, unitSeconds: 1440, genres: [], platforms: [] });
    const { entry: filmEntry } = await addEntry(me.id, film.id);
    const { entry: showEntry } = await addEntry(me.id, show.id);
    await db.update(entry).set({ status: "in_progress", progress: 3 }).where(eq(entry.id, showEntry.id)); // otherwise Home would pick this one anyway

    await bookSession(me.id, { title: "Board games", startsAt: hours(2), durationMin: 60 }, NOW);
    await bookSession(me.id, { itemId: film.id, title: "Interstellar", startsAt: hours(5), durationMin: 170 }, NOW);

    const home = await loadHome(me.id, "UTC", 300, undefined, NOW);
    expect(home.spotlight?.entryId).toBe(filmEntry.id);
    expect(home.spotlight?.plannedAt?.toISOString()).toBe(hours(5).toISOString());
  });
});
