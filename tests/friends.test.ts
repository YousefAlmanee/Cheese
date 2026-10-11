import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, friendGroup, friendship, groupMember, profile } from "@/db/schema";
import { loadGroupView } from "@/lib/common";
import {
  acceptInvite, addGroupMember, areFriends, createGroup, deleteGroup, friendLibrary, leaveGroup, listFriends, listGroups,
  listRequests, removeFriend, removeGroupMember, renameGroup, respondToRequest, sendFriendRequest, updateUsername, MAX_MEMBERS,
} from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import type { ItemDraft } from "@/lib/providers/types";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function befriend(a: { id: string }, b: { id: string; profile: { username: string } }) {
  const r = await sendFriendRequest(a.id, b.profile.username);
  if (!r.ok) throw new Error(r.error);
  expect(await respondToRequest(b.id, a.id, true)).toBe(true);
}

describe("friend requests", () => {
  it("asks by username, and the other person accepts", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const r = await sendFriendRequest(a.id, `@${b.profile.username.toUpperCase()}`);
    expect(r).toMatchObject({ ok: true });
    expect(await areFriends(a.id, b.id)).toBe(false);
    expect((await listRequests(b.id)).incoming.map((p) => p.userId)).toEqual([a.id]);
    expect((await listRequests(a.id)).outgoing.map((p) => p.userId)).toEqual([b.id]);

    expect(await respondToRequest(b.id, a.id, true)).toBe(true);
    expect(await areFriends(a.id, b.id)).toBe(true);
    expect((await listFriends(a.id)).map((p) => p.userId)).toEqual([b.id]);
    expect((await listFriends(b.id)).map((p) => p.userId)).toEqual([a.id]);
  });

  it("the person who asked cannot accept their own request", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await sendFriendRequest(a.id, b.profile.username);
    expect(await respondToRequest(a.id, b.id, true)).toBe(false);
    expect(await areFriends(a.id, b.id)).toBe(false);
  });

  it("declining removes the request and lets either try again", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await sendFriendRequest(a.id, b.profile.username);
    expect(await respondToRequest(b.id, a.id, false)).toBe(true);
    expect(await db.select().from(friendship)).toHaveLength(0);
    expect(await sendFriendRequest(b.id, a.profile.username)).toMatchObject({ ok: true });
  });

  it("asking someone who already asked you makes you friends straight away", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await sendFriendRequest(a.id, b.profile.username);
    const r = await sendFriendRequest(b.id, a.profile.username);
    expect(r).toMatchObject({ ok: true, message: "You and Yousef are now friends." });
    expect(await areFriends(a.id, b.id)).toBe(true);
  });

  it("explains duplicates, yourself, bad and unknown usernames", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await sendFriendRequest(a.id, b.profile.username);
    expect(await sendFriendRequest(a.id, b.profile.username)).toEqual({ ok: false, error: "You already asked Sara. They need to accept." });
    expect(await sendFriendRequest(a.id, a.profile.username)).toEqual({ ok: false, error: "That is you." });
    expect(await sendFriendRequest(a.id, "nobody_here")).toEqual({ ok: false, error: "No one has that username." });
    expect(await sendFriendRequest(a.id, "x")).toMatchObject({ ok: false });
    await respondToRequest(b.id, a.id, true);
    expect(await sendFriendRequest(a.id, b.profile.username)).toEqual({ ok: false, error: "You and Sara are already friends." });
  });

  it("either friend can end the friendship; a sent request can be cancelled; a received one cannot be 'removed'", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const c = await makeUser("Omar");
    await befriend(a, b);
    expect(await removeFriend(b.id, a.id)).toBe(true);
    expect(await areFriends(a.id, b.id)).toBe(false);

    await sendFriendRequest(a.id, c.profile.username);
    expect(await removeFriend(c.id, a.id)).toBe(false); // c should decline instead
    expect(await removeFriend(a.id, c.id)).toBe(true); // a cancels
    expect(await db.select().from(friendship)).toHaveLength(0);
  });
});

describe("invite links", () => {
  it("make you friends at once", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const r = await acceptInvite(b.id, a.profile.inviteCode);
    expect(r).toMatchObject({ ok: true, message: "You and Yousef are now friends." });
    expect(await areFriends(a.id, b.id)).toBe(true);
  });
  it("turn a pending request into a friendship instead of failing", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    await sendFriendRequest(b.id, a.profile.username);
    expect(await acceptInvite(b.id, a.profile.inviteCode)).toMatchObject({ ok: true });
    expect(await areFriends(a.id, b.id)).toBe(true);
  });
  it("reject your own link, a made-up code, and repeats", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    expect(await acceptInvite(a.id, a.profile.inviteCode)).toMatchObject({ ok: false });
    expect(await acceptInvite(b.id, "nonsense")).toEqual({ ok: false, error: "That invite link is not valid any more." });
    await acceptInvite(b.id, a.profile.inviteCode);
    expect(await acceptInvite(b.id, a.profile.inviteCode)).toMatchObject({ ok: true, message: "You and Yousef are already friends." });
    expect(await db.select().from(friendship)).toHaveLength(1);
  });
  it("are not case sensitive", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    expect(await acceptInvite(b.id, a.profile.inviteCode.toUpperCase())).toMatchObject({ ok: true });
  });
});

describe("usernames", () => {
  it("can be changed to a free one and not to a taken one", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    expect(await updateUsername(a.id, "Yousef_A")).toEqual({ ok: true });
    expect((await db.select().from(profile).where(eq(profile.userId, a.id)))[0].username).toBe("yousef_a");
    expect(await updateUsername(a.id, b.profile.username)).toEqual({ ok: false, error: "That username is taken." });
    expect(await updateUsername(a.id, "yousef_a")).toEqual({ ok: true }); // keeping your own is fine
    expect(await updateUsername(a.id, "no spaces")).toMatchObject({ ok: false });
  });
});

describe("groups", () => {
  async function trio() {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const c = await makeUser("Omar");
    await befriend(a, b);
    await befriend(a, c);
    return { a, b, c };
  }

  it("a group is made of the creator and their friends", async () => {
    const { a, b, c } = await trio();
    const r = await createGroup(a.id, "  Movie   nights ", [b.id, c.id, b.id]);
    if (!r.ok) throw new Error(r.error);
    const [g] = await listGroups(b.id);
    expect(g.name).toBe("Movie nights");
    expect(g.members.map((m) => m.userId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(g.ownerId).toBe(a.id);
  });

  it("cannot add people who are not your friends, and needs a name", async () => {
    const { a } = await trio();
    const stranger = await makeUser("Stranger");
    expect(await createGroup(a.id, "Club", [stranger.id])).toEqual({ ok: false, error: "You can only add your friends." });
    expect(await createGroup(a.id, "   ", [])).toEqual({ ok: false, error: "Give the group a name." });
    expect(await db.select().from(friendGroup)).toHaveLength(0);
  });

  it("members can add their friends; outsiders cannot add anyone", async () => {
    const { a, b } = await trio();
    const d = await makeUser("Dana");
    await befriend(b, d);
    const r = await createGroup(a.id, "Club", [b.id]);
    if (!r.ok) throw new Error();
    expect(await addGroupMember(b.id, r.id, d.id)).toEqual({ ok: true }); // Sara adds her friend
    expect(await addGroupMember(b.id, r.id, d.id)).toEqual({ ok: false, error: "They are already in the group." });
    const e = await makeUser("Eli");
    await befriend(e, d);
    expect(await addGroupMember(e.id, r.id, d.id)).toEqual({ ok: false, error: "You are not in that group." });
    expect(await addGroupMember(a.id, r.id, e.id)).toEqual({ ok: false, error: "You can only add your friends." });
  });

  it("has a size limit", async () => {
    const owner = await makeUser("Owner");
    const friends = [];
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const f = await makeUser(`Friend${i}`);
      await befriend(owner, f);
      friends.push(f);
    }
    expect(await createGroup(owner.id, "Too big", friends.map((f) => f.id))).toEqual({ ok: false, error: `A group can have up to ${MAX_MEMBERS} people.` });
    const r = await createGroup(owner.id, "Full", friends.slice(0, MAX_MEMBERS - 2).map((f) => f.id)); // 10 friends + owner = 11
    if (!r.ok) throw new Error(r.error);
    expect(await addGroupMember(owner.id, r.id, friends[MAX_MEMBERS - 2].id)).toEqual({ ok: true });
    const extra = await makeUser("Extra");
    await befriend(owner, extra);
    expect(await addGroupMember(owner.id, r.id, extra.id)).toMatchObject({ ok: false });
  });

  it("leaving passes ownership on, and the last person out closes the group", async () => {
    const { a, b, c } = await trio();
    const r = await createGroup(a.id, "Club", [b.id, c.id]);
    if (!r.ok) throw new Error();
    expect(await leaveGroup(a.id, r.id)).toBe(true);
    expect((await listGroups(b.id))[0].ownerId).toBe(b.id); // Sara joined before Omar
    expect(await leaveGroup(a.id, r.id)).toBe(false);
    await leaveGroup(b.id, r.id);
    await leaveGroup(c.id, r.id);
    expect(await db.select().from(friendGroup)).toHaveLength(0);
    expect(await db.select().from(groupMember)).toHaveLength(0);
  });

  it("only the owner can rename, remove others, or delete", async () => {
    const { a, b, c } = await trio();
    const r = await createGroup(a.id, "Club", [b.id, c.id]);
    if (!r.ok) throw new Error();
    expect(await renameGroup(b.id, r.id, "Mine now")).toBe(false);
    expect(await renameGroup(a.id, r.id, "Movie club")).toBe(true);
    expect(await removeGroupMember(b.id, r.id, c.id)).toBe(false);
    expect(await removeGroupMember(a.id, r.id, a.id)).toBe(false);
    expect(await removeGroupMember(a.id, r.id, c.id)).toBe(true);
    expect(await deleteGroup(b.id, r.id)).toBe(false);
    expect(await deleteGroup(a.id, r.id)).toBe(true);
  });
});

describe("what a friend can see", () => {
  const draft = (title: string, id: string): ItemDraft => ({ category: "movie", source: "tmdb", externalId: id, title, creator: null, year: null, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 6000, genres: [], platforms: [] });

  it("shows friends their list and ratings, but never hidden entries, and nothing to strangers", async () => {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const stranger = await makeUser("Stranger");
    await befriend(a, b);
    const open = await upsertItem(draft("Open", "movie/1"));
    const secret = await upsertItem(draft("Secret", "movie/2"));
    const e1 = (await addEntry(a.id, open.id)).entry;
    const e2 = (await addEntry(a.id, secret.id)).entry;
    await db.update(entry).set({ status: "done", ratingHalf: 9 }).where(eq(entry.id, e1.id));
    await db.update(entry).set({ hidden: true, ratingHalf: 2 }).where(eq(entry.id, e2.id));

    const view = await friendLibrary(b.id, a.id);
    expect(view?.rows.map((r) => [r.i.title, r.e.ratingHalf])).toEqual([["Open", 9]]);
    expect(await friendLibrary(stranger.id, a.id)).toBeNull();
    expect(await friendLibrary(a.id, a.id)).toBeNull(); // use the library page for your own
  });
});

describe("the group's common list", () => {
  const d = (title: string, ext: string, over: Partial<ItemDraft> = {}): ItemDraft => ({
    category: "movie", source: "tmdb", externalId: ext, title, creator: null, year: null, coverUrl: null, summary: null,
    unit: "watch", totalUnits: 1, unitSeconds: 120 * 60, genres: [], platforms: [], ...over,
  });

  async function club() {
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const c = await makeUser("Omar");
    await befriend(a, b);
    await befriend(a, c);
    const r = await createGroup(a.id, "Movie nights", [b.id, c.id]);
    if (!r.ok) throw new Error(r.error);
    const want = async (u: { id: string }, item: ItemDraft, patch: Partial<typeof entry.$inferInsert> = {}) => {
      const row = await upsertItem(item);
      const { entry: e } = await addEntry(u.id, row.id);
      await db.update(entry).set({ together: true, ...patch }).where(eq(entry.id, e.id));
      return row;
    };
    return { a, b, c, groupId: r.id, want };
  }

  it("lists what at least two want, most wanted first, with who", async () => {
    const { a, b, c, groupId, want } = await club();
    await want(a, d("Interstellar", "m/1")); await want(b, d("Interstellar", "m/1")); await want(c, d("Interstellar", "m/1"));
    await want(a, d("Perfect Days", "m/2")); await want(b, d("Perfect Days", "m/2"));
    await want(a, d("Only me", "m/3"));
    const v = (await loadGroupView(a.id, groupId))!;
    expect(v.rows.map((r) => [r.item.title, r.count])).toEqual([["Interstellar", 3], ["Perfect Days", 2]]);
    expect(v.rows[1].who.map((p) => p.displayName).sort()).toEqual(["Sara", "Yousef"]);
    expect(v.totalCommon).toBe(2);
    expect(v.group.members).toHaveLength(3);
  });

  it("leaves out hidden entries and things not open to doing together", async () => {
    const { a, b, c, groupId, want } = await club();
    await want(a, d("Hidden", "m/1")); await want(b, d("Hidden", "m/1"), { hidden: true });
    await want(a, d("Solo", "m/2")); await want(b, d("Solo", "m/2"), { together: false });
    await want(a, d("Both", "m/3")); await want(c, d("Both", "m/3"));
    const v = (await loadGroupView(a.id, groupId))!;
    expect(v.rows.map((r) => r.item.title)).toEqual(["Both"]);
  });

  it("counts finished things only when the person would do them again", async () => {
    const { a, b, groupId, want } = await club();
    await want(a, d("Seen it", "m/1")); await want(b, d("Seen it", "m/1"), { status: "done", progress: 1, wouldRedo: false });
    await want(a, d("Again", "m/2")); await want(b, d("Again", "m/2"), { status: "done", progress: 1, wouldRedo: true });
    await want(a, d("Gave up", "m/3")); await want(b, d("Gave up", "m/3"), { status: "dropped" });
    const v = (await loadGroupView(a.id, groupId))!;
    expect(v.rows.map((r) => r.item.title)).toEqual(["Again"]);
  });

  it("is only visible to members, and removing someone removes their wants", async () => {
    const { a, b, c, groupId, want } = await club();
    const outsider = await makeUser("Outsider");
    await want(a, d("X", "m/1")); await want(b, d("X", "m/1"));
    expect(await loadGroupView(outsider.id, groupId)).toBeNull();
    await removeGroupMember(a.id, groupId, b.id);
    expect((await loadGroupView(a.id, groupId))!.rows).toHaveLength(0);
    expect(c.id).toBeTruthy();
  });

  it("filters by category, length, and platform", async () => {
    const { a, b, groupId, want } = await club();
    await want(a, d("Short film", "m/1", { unitSeconds: 80 * 60 })); await want(b, d("Short film", "m/1", { unitSeconds: 80 * 60 }));
    await want(a, d("Long film", "m/2", { unitSeconds: 170 * 60 })); await want(b, d("Long film", "m/2", { unitSeconds: 170 * 60 }));
    const game = d("Co-op game", "g/1", { category: "game", source: "igdb", unit: "minute", totalUnits: 600, unitSeconds: 60, platforms: ["PS5", "PC"] });
    await want(a, game, { platform: "PS5" }); await want(b, game, { platform: "PC" });
    const game2 = d("Friendly game", "g/2", { category: "game", source: "igdb", unit: "minute", totalUnits: 600, unitSeconds: 60, platforms: ["PS5", "PC"] });
    await want(a, game2, { platform: "PS5" }); await want(b, game2, { platform: null });

    const titles = async (f: Parameters<typeof loadGroupView>[2]) => (await loadGroupView(a.id, groupId, f))!.rows.map((r) => r.item.title).sort();
    expect(await titles({})).toEqual(["Co-op game", "Friendly game", "Long film", "Short film"]);
    expect(await titles({ category: "game" })).toEqual(["Co-op game", "Friendly game"]);
    expect(await titles({ underMinutes: 120 })).toEqual(["Short film"]); // games are 10h, the long film is 2h 50m
    expect(await titles({ samePlatform: true })).toEqual(["Friendly game", "Long film", "Short film"]); // PS5 vs PC is out
  });

  it("shows whether I already have it, and computes a taste match", async () => {
    const { a, b, groupId, want } = await club();
    const film = d("Interstellar", "m/1");
    await want(a, film); await want(b, film);
    const v = (await loadGroupView(a.id, groupId))!;
    expect(v.rows[0].mine).toMatchObject({ status: "want", together: true });
    expect(v.match).not.toBeNull();
    const [row] = await db.select().from(entry).where(eq(entry.userId, b.id));
    await db.delete(entry).where(eq(entry.id, row.id));
    const viewForB = (await loadGroupView(b.id, groupId))!;
    expect(viewForB.rows).toHaveLength(0); // only Yousef wants it now
  });

  it("says nothing about the match until there is something to compare", async () => {
    const { a, groupId } = await club();
    expect((await loadGroupView(a.id, groupId))!.match).toBeNull();
  });
});

describe("friend hints", () => {
  it("names the friends who also want an item, and nobody else", async () => {
    const { friendsWanting, wantingHint } = await import("@/lib/friends");
    const a = await makeUser("Yousef");
    const b = await makeUser("Sara");
    const c = await makeUser("Omar");
    const d = await makeUser("Dana");
    await befriend(a, b);
    await befriend(a, c); // Dana is not a friend
    const film = await upsertItem({ category: "movie", source: "tmdb", externalId: "m/1", title: "Film", creator: null, year: null, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 6000, genres: [], platforms: [] });
    for (const [u, patch] of [[b, {}], [c, { hidden: true }], [d, {}]] as const) {
      const { entry: e } = await addEntry(u.id, film.id);
      await db.update(entry).set({ together: true, ...patch }).where(eq(entry.id, e.id));
    }
    expect(await friendsWanting(a.id, film.id)).toEqual(["Sara"]); // Omar hid it, Dana is not a friend
    expect(await friendsWanting(a.id, "00000000-0000-4000-8000-000000000000")).toEqual([]);
    expect(wantingHint([])).toBe("Open to doing this with friends");
    expect(wantingHint(["Sara"])).toBe("Sara wants this too");
    expect(wantingHint(["Sara", "Omar"])).toBe("Sara and Omar want this");
    expect(wantingHint(["Sara", "Omar", "Lina"])).toBe("Sara, Omar and Lina want this");
    expect(wantingHint(["Sara", "Omar", "Lina", "Khalid"])).toBe("Sara, Omar and 2 more want this");
  });
});

describe("friendship ordering", () => {
  it("is checked byte-wise, whatever collation the database was created with", async () => {
    const res = await db.execute<{ def: string }>(sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'friendship_order'`);
    expect(res.rows[0].def).toContain('COLLATE "C"');
  });
});
