import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { sendFriendRequest, respondToRequest } from "@/lib/friends";
import { loadFriendShelves } from "@/lib/home-friends";
import { addEntry, upsertItem } from "@/lib/library";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const draft = (title: string, category: "movie" | "anime", externalId: string) => ({
  category, source: category === "movie" ? ("tmdb" as const) : ("anilist" as const), externalId, title,
  creator: null, year: null, coverUrl: null, summary: null, unit: category === "movie" ? ("watch" as const) : ("episode" as const),
  totalUnits: 1, unitSeconds: 3600, genres: [], platforms: [],
});

async function befriend(a: { id: string }, b: { id: string; profile: { username: string } }) {
  const r = await sendFriendRequest(a.id, b.profile.username);
  if (!r.ok) throw new Error(r.error);
  await respondToRequest(b.id, a.id, true);
}

describe("loadFriendShelves", () => {
  it("has no shelves and no friends for someone alone", async () => {
    const me = await makeUser("Yousef");
    expect(await loadFriendShelves(me.id)).toEqual({ friendCount: 0, shelves: [] });
  });

  it("counts friends but shows no shelf when nothing is shared", async () => {
    const me = await makeUser("Yousef");
    const sara = await makeUser("Sara");
    await befriend(me, sara);
    await addEntry(me.id, (await upsertItem(draft("Dune", "movie", "m/1"))).id);
    await addEntry(sara.id, (await upsertItem(draft("Arrival", "movie", "m/2"))).id);
    expect(await loadFriendShelves(me.id)).toMatchObject({ friendCount: 1, shelves: [] });
  });

  it("makes one shelf per friend with only the items they share, filterable by category, skipping hidden ones", async () => {
    const me = await makeUser("Yousef");
    const sara = await makeUser("Sara");
    const omar = await makeUser("Omar");
    await befriend(me, sara);
    await befriend(me, omar);
    const dune = await upsertItem(draft("Dune", "movie", "m/1"));
    const frieren = await upsertItem(draft("Frieren", "anime", "a/1"));
    const secret = await upsertItem(draft("Secret", "movie", "m/3"));
    for (const u of [me, sara]) await addEntry(u.id, dune.id);
    for (const u of [me, sara, omar]) await addEntry(u.id, frieren.id);
    for (const u of [me, omar]) await addEntry(u.id, secret.id);

    const all = await loadFriendShelves(me.id);
    expect(all.friendCount).toBe(2);
    expect(all.shelves.map((s) => [s.friend.userId, s.items.map((i) => i.title).sort()])).toEqual([
      // Both share two items, so the tie falls back to A to Z.
      [omar.id, ["Frieren", "Secret"]],
      [sara.id, ["Dune", "Frieren"]],
    ]);

    const anime = await loadFriendShelves(me.id, "anime");
    expect(anime.shelves.every((s) => s.items.length === 1 && s.items[0].title === "Frieren")).toBe(true);

    await db.update(entry).set({ hidden: true }).where(and(eq(entry.userId, omar.id), eq(entry.itemId, secret.id)));
    const afterHide = await loadFriendShelves(me.id);
    expect(afterHide.shelves.find((s) => s.friend.userId === omar.id)?.items.map((i) => i.title)).toEqual(["Frieren"]);

    await db.update(entry).set({ hidden: true }).where(and(eq(entry.userId, me.id), eq(entry.itemId, frieren.id)));
    const mineHidden = await loadFriendShelves(me.id);
    expect(mineHidden.shelves.map((s) => s.friend.userId)).toEqual([sara.id]);
  });
});
