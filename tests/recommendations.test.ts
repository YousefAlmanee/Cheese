import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => undefined) } }));

import { db } from "@/db";
import { entry, notification } from "@/db/schema";
import { respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import { acceptRecommendation, dismissRecommendation, friendsToRecommendTo, listReceived, recommend } from "@/lib/recommendations";
import { makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

async function befriend(a: { id: string }, b: { id: string; profile: { username: string } }) {
  await sendFriendRequest(a.id, b.profile.username);
  await respondToRequest(b.id, a.id, true);
}

async function movie(title = "Dune") {
  return upsertItem({
    category: "movie", source: "tmdb", externalId: `movie/${title}`, title, creator: null, year: 2021, coverUrl: null, summary: null,
    unit: "watch", totalUnits: 1, unitSeconds: 7200, genres: [], platforms: [],
  });
}

async function setup() {
  const me = await makeUser("Yousef");
  const sara = await makeUser("Sara");
  await befriend(me, sara);
  const it = await movie();
  await addEntry(me.id, it.id);
  return { me, sara, it };
}

describe("recommend", () => {
  it("sends it to a friend, who is notified and sees it in their list", async () => {
    const { me, sara, it } = await setup();
    expect(await recommend(me.id, it.id, [sara.id], "  you will love it  ")).toEqual({ ok: true, sent: 1 });
    const got = await listReceived(sara.id);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ note: "you will love it", from: { userId: me.id }, item: { title: "Dune" } });
    const [n] = await db.select().from(notification).where(and(eq(notification.userId, sara.id), eq(notification.type, "recommendation")));
    expect(n).toMatchObject({ title: "Yousef recommends Dune", body: "you will love it", url: "/friends" });
  });

  it("cuts a long note to 200 characters", async () => {
    const { me, sara, it } = await setup();
    await recommend(me.id, it.id, [sara.id], "x".repeat(500));
    expect((await listReceived(sara.id))[0].note).toHaveLength(200);
  });

  it("sending again is a no-op", async () => {
    const { me, sara, it } = await setup();
    await recommend(me.id, it.id, [sara.id]);
    const again = await recommend(me.id, it.id, [sara.id]);
    expect(again.ok).toBe(false);
    expect(await listReceived(sara.id)).toHaveLength(1);
  });

  it("will not send to someone who is not a friend", async () => {
    const { me, it } = await setup();
    const stranger = await makeUser("Omar");
    expect((await recommend(me.id, it.id, [stranger.id])).ok).toBe(false);
    expect(await listReceived(stranger.id)).toHaveLength(0);
  });

  it("will not send to a friend request that is still pending", async () => {
    const { me, it } = await setup();
    const omar = await makeUser("Omar");
    await sendFriendRequest(me.id, omar.profile.username);
    expect((await recommend(me.id, it.id, [omar.id])).ok).toBe(false);
  });

  it("will not send something that is not in the sender's library", async () => {
    const { me, sara } = await setup();
    const other = await movie("Other");
    expect(await recommend(me.id, other.id, [sara.id])).toEqual({ ok: false, error: "That is not in your library." });
  });

  it("will not send something the sender hid from friends", async () => {
    const { me, sara, it } = await setup();
    await db.update(entry).set({ hidden: true }).where(and(eq(entry.userId, me.id), eq(entry.itemId, it.id)));
    expect((await recommend(me.id, it.id, [sara.id])).ok).toBe(false);
    expect(await listReceived(sara.id)).toHaveLength(0);
  });

  it("will not send to yourself, and ignores duplicates in the list", async () => {
    const { me, sara, it } = await setup();
    expect((await recommend(me.id, it.id, [me.id])).ok).toBe(false);
    expect(await recommend(me.id, it.id, [sara.id, sara.id])).toEqual({ ok: true, sent: 1 });
  });

  it("skips a friend who already has it, but still reaches the others", async () => {
    const { me, sara, it } = await setup();
    const omar = await makeUser("Omar");
    await befriend(me, omar);
    await addEntry(sara.id, it.id);
    expect(await recommend(me.id, it.id, [sara.id, omar.id])).toEqual({ ok: true, sent: 1 });
    expect(await listReceived(sara.id)).toHaveLength(0);
    expect(await listReceived(omar.id)).toHaveLength(1);
  });

  it("does not reveal a friend's hidden entry: they are still offered it", async () => {
    const { me, sara, it } = await setup();
    await addEntry(sara.id, it.id);
    await db.update(entry).set({ hidden: true }).where(and(eq(entry.userId, sara.id), eq(entry.itemId, it.id)));
    const list = await friendsToRecommendTo(me.id, it.id);
    expect(list.map((c) => c.person.userId)).toEqual([sara.id]);
  });
});

describe("friendsToRecommendTo", () => {
  it("marks the ones already sent", async () => {
    const { me, sara, it } = await setup();
    expect((await friendsToRecommendTo(me.id, it.id))[0]).toMatchObject({ alreadySent: false });
    await recommend(me.id, it.id, [sara.id]);
    expect((await friendsToRecommendTo(me.id, it.id))[0]).toMatchObject({ alreadySent: true });
  });
});

describe("answering", () => {
  it("accepting adds it to the recipient's list as Want to, and clears it", async () => {
    const { me, sara, it } = await setup();
    await recommend(me.id, it.id, [sara.id]);
    const [r] = await listReceived(sara.id);
    const res = await acceptRecommendation(sara.id, r.id);
    expect(res).not.toBeNull();
    const [e] = await db.select().from(entry).where(and(eq(entry.userId, sara.id), eq(entry.itemId, it.id)));
    expect(e).toMatchObject({ id: res!.entryId, status: "want" });
    expect(await listReceived(sara.id)).toHaveLength(0);
  });

  it("dismissing clears it and the sender cannot send it again", async () => {
    const { me, sara, it } = await setup();
    await recommend(me.id, it.id, [sara.id]);
    const [r] = await listReceived(sara.id);
    expect(await dismissRecommendation(sara.id, r.id)).toBe(true);
    expect(await listReceived(sara.id)).toHaveLength(0);
    expect((await recommend(me.id, it.id, [sara.id])).ok).toBe(false);
    expect(await dismissRecommendation(sara.id, r.id)).toBe(false);
  });

  it("only the recipient can answer", async () => {
    const { me, sara, it } = await setup();
    const omar = await makeUser("Omar");
    await recommend(me.id, it.id, [sara.id]);
    const [r] = await listReceived(sara.id);
    expect(await acceptRecommendation(omar.id, r.id)).toBeNull();
    expect(await acceptRecommendation(me.id, r.id)).toBeNull();
    expect(await dismissRecommendation(omar.id, r.id)).toBe(false);
    expect(await listReceived(sara.id)).toHaveLength(1);
  });

  it("drops one the recipient already added themselves", async () => {
    const { me, sara, it } = await setup();
    await recommend(me.id, it.id, [sara.id]);
    await addEntry(sara.id, it.id);
    expect(await listReceived(sara.id)).toHaveLength(0);
  });

  it("goes quiet once the two are no longer friends", async () => {
    const { me, sara, it } = await setup();
    await recommend(me.id, it.id, [sara.id]);
    const { removeFriend } = await import("@/lib/friends");
    await removeFriend(me.id, sara.id);
    expect(await listReceived(sara.id)).toHaveLength(0);
  });
});
