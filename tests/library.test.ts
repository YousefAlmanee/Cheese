import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, item } from "@/db/schema";
import { listLibrary } from "@/lib/library-query";
import { addEntry, addFromRef, addManual, libraryStatuses, manualDraft, upsertItem } from "@/lib/library";
import type { ItemDraft } from "@/lib/providers/types";
import { makeUser, resetDb } from "./helpers";

const dune: ItemDraft = {
  category: "movie", source: "tmdb", externalId: "movie/438631", title: "Dune", creator: "Denis Villeneuve", year: 2021, coverUrl: null,
  summary: null, unit: "watch", totalUnits: 1, unitSeconds: 155 * 60, genres: ["Science Fiction"], platforms: [],
};

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("upsertItem", () => {
  it("stores one row per source id and refreshes its details", async () => {
    const a = await upsertItem(dune);
    const b = await upsertItem({ ...dune, title: "Dune (2021)", unitSeconds: 156 * 60 });
    expect(b.id).toBe(a.id);
    expect(b.title).toBe("Dune (2021)");
    expect(await db.select().from(item)).toHaveLength(1);
  });

  it("keeps same-numbered ids from different sources apart", async () => {
    await upsertItem(dune);
    await upsertItem({ ...dune, source: "igdb", externalId: "movie/438631", category: "game", unit: "minute" });
    expect(await db.select().from(item)).toHaveLength(2);
  });

  it("never merges manual items", async () => {
    const me = await makeUser("Yousef");
    await upsertItem(manualDraft({ category: "movie", title: "Home video" }), me.id);
    await upsertItem(manualDraft({ category: "movie", title: "Home video" }), me.id);
    expect(await db.select().from(item)).toHaveLength(2);
  });
});

describe("addEntry", () => {
  it("is idempotent and does not reset progress", async () => {
    const me = await makeUser("Yousef");
    const it = await upsertItem(dune);
    const first = await addEntry(me.id, it.id);
    expect(first.created).toBe(true);
    await db.update(entry).set({ progress: 1, status: "done" }).where(eq(entry.id, first.entry.id));
    const second = await addEntry(me.id, it.id);
    expect(second.created).toBe(false);
    expect(second.entry.status).toBe("done");
    expect(await db.select().from(entry)).toHaveLength(1);
  });

  it("lets two people share one catalog row with separate entries", async () => {
    const a = await makeUser("Sara");
    const b = await makeUser("Omar");
    const it = await upsertItem(dune);
    await addEntry(a.id, it.id);
    await addEntry(b.id, it.id);
    expect(await db.select().from(item)).toHaveLength(1);
    expect(await db.select().from(entry)).toHaveLength(2);
  });
});

describe("addFromRef", () => {
  function tmdbReturns(body: unknown) {
    vi.stubEnv("TMDB_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  }

  it("stores what the provider says, not what the browser claims", async () => {
    const me = await makeUser("Yousef");
    tmdbReturns({ id: 438631, title: "Dune", release_date: "2021-09-15", runtime: 155 });
    const res = await addFromRef(me.id, { source: "tmdb", externalId: "movie/438631", category: "movie" });
    expect(res.created).toBe(true);
    const [row] = await db.select().from(item);
    expect(row).toMatchObject({ title: "Dune", unitSeconds: 155 * 60, year: 2021 });
  });

  it("fails cleanly when the source is not configured", async () => {
    const me = await makeUser("Yousef");
    vi.stubEnv("TMDB_API_KEY", "");
    await expect(addFromRef(me.id, { source: "tmdb", externalId: "movie/1", category: "movie" })).rejects.toThrow(/not available/);
    expect(await db.select().from(entry)).toHaveLength(0);
  });

  it("does not create an entry when the source is down", async () => {
    const me = await makeUser("Yousef");
    vi.stubEnv("TMDB_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 503 })));
    await expect(addFromRef(me.id, { source: "tmdb", externalId: "movie/1", category: "movie" })).rejects.toThrow();
    expect(await db.select().from(item)).toHaveLength(0);
  });
});

describe("manualDraft", () => {
  it("movie: runtime in minutes, one watch", () => {
    expect(manualDraft({ category: "movie", title: " Home video ", minutes: 95 })).toMatchObject({ title: "Home video", unit: "watch", totalUnits: 1, unitSeconds: 5700, source: "manual", externalId: null });
  });
  it("movie without a runtime uses a typical length", () => {
    expect(manualDraft({ category: "movie", title: "X" }).unitSeconds).toBe(110 * 60);
  });
  it("series and anime: episodes and minutes each", () => {
    expect(manualDraft({ category: "anime", title: "X", count: 12, minutes: 24 })).toMatchObject({ unit: "episode", totalUnits: 12, unitSeconds: 1440 });
  });
  it("book and manga: just a count", () => {
    expect(manualDraft({ category: "book", title: "X", count: 320 })).toMatchObject({ unit: "page", totalUnits: 320, unitSeconds: null });
    expect(manualDraft({ category: "manga", title: "X" })).toMatchObject({ unit: "chapter", totalUnits: null });
  });
  it("game: hours become minutes", () => {
    expect(manualDraft({ category: "game", title: "X", hours: 12 })).toMatchObject({ unit: "minute", totalUnits: 720, unitSeconds: 60 });
  });
  it("ignores nonsense numbers and rejects an empty title", () => {
    expect(manualDraft({ category: "book", title: "X", count: -5 }).totalUnits).toBeNull();
    expect(manualDraft({ category: "book", title: "X", count: Number.NaN }).totalUnits).toBeNull();
    expect(() => manualDraft({ category: "book", title: "   " })).toThrow();
  });
});

describe("addManual and libraryStatuses", () => {
  it("adds a manual item to the library", async () => {
    const me = await makeUser("Yousef");
    const { entryId } = await addManual(me.id, { category: "book", title: "Family recipe notebook", count: 80 });
    const e = await db.query.entry.findFirst({ where: eq(entry.id, entryId) });
    expect(e).toMatchObject({ userId: me.id, status: "want", priority: "someday", together: false });
  });

  it("reports which search hits are already in my library", async () => {
    const me = await makeUser("Yousef");
    const other = await makeUser("Sara");
    const row = await upsertItem(dune);
    const { entry: e } = await addEntry(me.id, row.id);
    await addEntry(other.id, (await upsertItem({ ...dune, externalId: "movie/2", title: "Other" })).id);
    const map = await libraryStatuses(me.id, [dune, { ...dune, externalId: "movie/2" }, { ...dune, externalId: "movie/3" }]);
    expect(Object.keys(map)).toEqual(["tmdb:movie/438631"]);
    expect(map["tmdb:movie/438631"]).toEqual({ entryId: e.id, status: "want" });
  });
});

describe("listLibrary", () => {
  it("returns one page and the full count, in the chosen order", async () => {
    const me = await makeUser("Yousef");
    for (let i = 0; i < 5; i++) {
      const it = await upsertItem(manualDraft({ category: "movie", title: `Film ${i}` }), me.id);
      await addEntry(me.id, it.id);
    }
    const f = { sort: "recent" as const, mustOnly: false };
    const first = await listLibrary(me.id, f, 2);
    expect(first.total).toBe(5);
    expect(first.rows).toHaveLength(2);
    expect((await listLibrary(me.id, f, 60)).rows).toHaveLength(5);
  });
});
