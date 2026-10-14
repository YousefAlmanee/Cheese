import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => undefined) } }));

import { db } from "@/db";
import { entry, groupSwipe, notification } from "@/db/schema";
import { createGroup, leaveGroup, respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import { loadDeck, loadResults, resetMine, swipe } from "@/lib/swipe";
import { makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

async function befriend(a: { id: string }, b: { id: string; profile: { username: string } }) {
  await sendFriendRequest(a.id, b.profile.username);
  await respondToRequest(b.id, a.id, true);
}

async function movie(title: string) {
  return upsertItem({
    category: "movie", source: "tmdb", externalId: `movie/${title}`, title, creator: null, year: 2020, coverUrl: null, summary: null,
    unit: "watch", totalUnits: 1, unitSeconds: 7200, genres: [], platforms: [],
  });
}

async function want(userId: string, itemId: string) {
  const { entry: e } = await addEntry(userId, itemId);
  await db.update(entry).set({ together: true }).where(eq(entry.id, e.id));
}

/** Yousef, Sara and Omar in one group who all want Dune and Parasite; only Yousef and Sara want Heat. */
async function setup() {
  const me = await makeUser("Yousef");
  const sara = await makeUser("Sara");
  const omar = await makeUser("Omar");
  await befriend(me, sara);
  await befriend(me, omar);
  const g = await createGroup(me.id, "Movie nights", [sara.id, omar.id]);
  if (!g.ok) throw new Error(g.error);
  const dune = await movie("Dune");
  const parasite = await movie("Parasite");
  const heat = await movie("Heat");
  for (const u of [me, sara, omar]) {
    await want(u.id, dune.id);
    await want(u.id, parasite.id);
  }
  await want(me.id, heat.id);
  await want(sara.id, heat.id);
  return { me, sara, omar, groupId: g.id, dune, parasite, heat };
}

const notes = (userId: string) => db.select().from(notification).where(and(eq(notification.userId, userId), eq(notification.type, "swipe_match")));

describe("the deck", () => {
  it("is the group's common list, and shrinks as the viewer swipes", async () => {
    const s = await setup();
    const deck = (await loadDeck(s.me.id, s.groupId))!;
    expect(deck.total).toBe(3);
    expect(deck.todo.map((r) => r.item.title).sort()).toEqual(["Dune", "Heat", "Parasite"]);
    await swipe(s.me.id, s.groupId, s.dune.id, true);
    const after = (await loadDeck(s.me.id, s.groupId))!;
    expect(after.todo.map((r) => r.item.title)).not.toContain("Dune");
    // Someone else's progress does not touch this deck.
    expect((await loadDeck(s.sara.id, s.groupId))!.todo).toHaveLength(3);
  });

  it("is hidden from people outside the group", async () => {
    const s = await setup();
    const stranger = await makeUser("Layla");
    expect(await loadDeck(stranger.id, s.groupId)).toBeNull();
    expect(await loadResults(stranger.id, s.groupId)).toBeNull();
    expect(await swipe(stranger.id, s.groupId, s.dune.id, true)).toEqual({ ok: false, error: "You are not in that group." });
  });

  it("never names someone who hid the item as wanting it", async () => {
    const s = await setup();
    await db.update(entry).set({ hidden: true }).where(and(eq(entry.userId, s.omar.id), eq(entry.itemId, s.dune.id)));
    const dune = (await loadDeck(s.me.id, s.groupId))!.todo.find((r) => r.item.id === s.dune.id)!;
    expect(dune.who.map((p) => p.displayName).sort()).toEqual(["Sara", "Yousef"]);
  });
});

describe("swiping", () => {
  it("refuses an item that is not on the group's list", async () => {
    const s = await setup();
    const solo = await movie("Solo");
    await want(s.me.id, solo.id);
    expect((await swipe(s.me.id, s.groupId, solo.id, true)).ok).toBe(false);
    expect(await db.select().from(groupSwipe)).toHaveLength(0);
  });

  it("answering again changes the answer", async () => {
    const s = await setup();
    await swipe(s.me.id, s.groupId, s.dune.id, false);
    await swipe(s.me.id, s.groupId, s.dune.id, true);
    const rows = await db.select().from(groupSwipe);
    expect(rows).toHaveLength(1);
    expect(rows[0].liked).toBe(true);
  });

  it("tells the others once, when the last yes makes it unanimous", async () => {
    const s = await setup();
    expect(await swipe(s.me.id, s.groupId, s.dune.id, true)).toEqual({ ok: true, unanimous: false });
    expect(await swipe(s.sara.id, s.groupId, s.dune.id, true)).toEqual({ ok: true, unanimous: false });
    expect(await notes(s.me.id)).toHaveLength(0);
    expect(await swipe(s.omar.id, s.groupId, s.dune.id, true)).toEqual({ ok: true, unanimous: true });
    expect(await notes(s.me.id)).toHaveLength(1);
    expect(await notes(s.sara.id)).toHaveLength(1);
    expect(await notes(s.omar.id)).toHaveLength(0); // they just did it
    expect((await notes(s.me.id))[0]).toMatchObject({ title: "Movie nights: everyone wants Dune", url: `/friends/group/${s.groupId}/swipe` });
    // Saying yes again does not notify again.
    await swipe(s.omar.id, s.groupId, s.dune.id, true);
    expect(await notes(s.me.id)).toHaveLength(1);
  });

  it("does not notify when someone says no", async () => {
    const s = await setup();
    await swipe(s.me.id, s.groupId, s.dune.id, true);
    await swipe(s.sara.id, s.groupId, s.dune.id, true);
    await swipe(s.omar.id, s.groupId, s.dune.id, false);
    expect(await notes(s.me.id)).toHaveLength(0);
  });
});

describe("results", () => {
  it("puts what everyone liked first, then by yes count, and shows only the yes", async () => {
    const s = await setup();
    await swipe(s.me.id, s.groupId, s.parasite.id, true);
    await swipe(s.sara.id, s.groupId, s.parasite.id, true);
    await swipe(s.omar.id, s.groupId, s.parasite.id, false);
    await swipe(s.me.id, s.groupId, s.dune.id, true);
    await swipe(s.sara.id, s.groupId, s.dune.id, true);
    await swipe(s.omar.id, s.groupId, s.dune.id, true);
    await swipe(s.me.id, s.groupId, s.heat.id, false);
    const res = (await loadResults(s.me.id, s.groupId))!;
    expect(res.map((r) => [r.row.item.title, r.yes.length, r.everyone])).toEqual([
      ["Dune", 3, true],
      ["Parasite", 2, false],
    ]);
    expect(res[1].yes.map((p) => p.displayName).sort()).toEqual(["Sara", "Yousef"]);
    expect(res[1].answered).toBe(3);
  });

  it("an item only counts as unanimous for the people still in the group", async () => {
    const s = await setup();
    await swipe(s.me.id, s.groupId, s.dune.id, true);
    await swipe(s.sara.id, s.groupId, s.dune.id, true);
    await swipe(s.omar.id, s.groupId, s.dune.id, false);
    await leaveGroup(s.omar.id, s.groupId);
    const res = (await loadResults(s.me.id, s.groupId))!;
    expect(res[0]).toMatchObject({ everyone: true });
    expect(res[0].yes).toHaveLength(2);
  });

  it("a group of one has no unanimous result", async () => {
    const me = await makeUser("Yousef");
    const g = await createGroup(me.id, "Solo", []);
    if (!g.ok) throw new Error(g.error);
    const it = await movie("Dune");
    await want(me.id, it.id);
    expect((await loadDeck(me.id, g.id))!.total).toBe(0);
  });
});

describe("start over", () => {
  it("clears only the viewer's own answers", async () => {
    const s = await setup();
    await swipe(s.me.id, s.groupId, s.dune.id, true);
    await swipe(s.sara.id, s.groupId, s.dune.id, true);
    expect(await resetMine(s.me.id, s.groupId)).toBe(true);
    const rows = await db.select().from(groupSwipe);
    expect(rows.map((r) => r.userId)).toEqual([s.sara.id]);
    expect((await loadDeck(s.me.id, s.groupId))!.todo).toHaveLength(3);
  });

  it("is refused for outsiders", async () => {
    const s = await setup();
    const stranger = await makeUser("Layla");
    await swipe(s.me.id, s.groupId, s.dune.id, true);
    expect(await resetMine(stranger.id, s.groupId)).toBe(false);
    expect(await db.select().from(groupSwipe)).toHaveLength(1);
  });
});
