import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, friendGroup, freeWindow, night, nightParticipant, nightVote, planSession, profile } from "@/db/schema";
import { createGroup, respondToRequest, sendFriendRequest } from "@/lib/friends";
import { addEntry, upsertItem } from "@/lib/library";
import { cancelNight, createNight, joinAsGuest, lockIn, markNightDone, nightByToken, nightForMember, reopenVoting, setRsvp, suggestOptions, toggleVote, MAX_GUESTS } from "@/lib/nights";
import { completeSession, sessionsForFeed } from "@/lib/sessions";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-11T12:00:00Z");
const at = (iso: string) => new Date(iso);

async function club() {
  const a = await makeUser("Yousef");
  const b = await makeUser("Sara");
  const c = await makeUser("Omar");
  for (const x of [b, c]) {
    await sendFriendRequest(a.id, x.profile.username);
    await respondToRequest(x.id, a.id, true);
  }
  const g = await createGroup(a.id, "Movie nights", [b.id, c.id]);
  if (!g.ok) throw new Error(g.error);
  const film = await upsertItem({ category: "movie", source: "tmdb", externalId: "movie/1", title: "Interstellar", creator: null, year: null, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: 169 * 60, genres: [], platforms: [] });
  const show = await upsertItem({ category: "anime", source: "anilist", externalId: "1", title: "Frieren", creator: null, year: null, coverUrl: null, summary: null, unit: "episode", totalUnits: 28, unitSeconds: 1440, genres: [], platforms: [] });
  const opts = [
    { startsAt: at("2026-10-16T17:00:00Z"), durationMin: 170 },
    { startsAt: at("2026-10-17T17:00:00Z"), durationMin: 170 },
  ];
  return { a, b, c, groupId: g.id, film, show, opts };
}

async function newNight(over: Partial<Parameters<typeof createNight>[1]> = {}) {
  const k = await club();
  const res = await createNight(k.a.id, { groupId: k.groupId, itemId: k.film.id, options: k.opts, ...over }, NOW);
  if (!res.ok) throw new Error(res.error);
  return { ...k, nightId: res.id };
}

describe("createNight", () => {
  it("invites the whole group and fills in the host's own votes", async () => {
    const { a, b, c, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    expect(v.night.status).toBe("voting");
    expect(v.participants.map((p) => p.name).sort()).toEqual(["Omar", "Sara", "Yousef"]);
    expect(v.options).toHaveLength(2);
    const host = v.participants.find((p) => p.userId === a.id)!;
    expect(v.options.every((o) => o.voterIds.includes(host.id))).toBe(true);
    expect(v.options[0].count).toBe(1);
    expect(v.groupName).toBe("Movie nights");
    expect(v.host).toMatchObject({ userId: a.id, name: "Yousef" });
    expect(await nightForMember(b.id, nightId)).not.toBeNull();
    expect(c.id).toBeTruthy();
  });

  it("only group members can propose, and only for a real item with sensible times", async () => {
    const k = await club();
    const stranger = await makeUser("Stranger");
    const base = { groupId: k.groupId, itemId: k.film.id, options: k.opts };
    expect(await createNight(stranger.id, base, NOW)).toEqual({ ok: false, error: "You are not in that group." });
    expect(await createNight(k.a.id, { ...base, itemId: "00000000-0000-4000-8000-000000000000" }, NOW)).toMatchObject({ ok: false });
    expect(await createNight(k.a.id, { ...base, options: [] }, NOW)).toEqual({ ok: false, error: "Suggest at least one time." });
    expect(await createNight(k.a.id, { ...base, options: [{ startsAt: at("2026-10-10T17:00:00Z"), durationMin: 60 }] }, NOW)).toEqual({ ok: false, error: "Those times have already passed." });
    expect(await createNight(k.a.id, { ...base, options: [{ startsAt: at("2026-10-16T17:00:00Z"), durationMin: 2 }] }, NOW)).toMatchObject({ ok: false });
    const many = Array.from({ length: 7 }, (_, i) => ({ startsAt: new Date(at("2026-10-16T17:00:00Z").getTime() + i * 3600_000), durationMin: 60 }));
    expect(await createNight(k.a.id, { ...base, options: many }, NOW)).toMatchObject({ ok: false });
    expect(await db.select().from(night)).toHaveLength(0);
  });

  it("ignores duplicate times", async () => {
    const k = await club();
    const same = { startsAt: at("2026-10-16T17:00:00Z"), durationMin: 100 };
    const r = await createNight(k.a.id, { groupId: k.groupId, itemId: k.film.id, options: [same, same] }, NOW);
    if (!r.ok) throw new Error();
    expect((await nightForMember(k.a.id, r.id))!.options).toHaveLength(1);
  });

  it("outsiders cannot see a night, even by guessing its id", async () => {
    const { nightId } = await newNight();
    const stranger = await makeUser("Stranger");
    expect(await nightForMember(stranger.id, nightId)).toBeNull();
  });
});

describe("voting", () => {
  it("members switch their own vote on and off", async () => {
    const { b, nightId } = await newNight();
    const v0 = (await nightForMember(b.id, nightId))!;
    const opt = v0.options[1].id;
    expect(await toggleVote({ nightId, userId: b.id }, opt)).toEqual({ ok: true, voted: true });
    expect((await nightForMember(b.id, nightId))!.options[1].count).toBe(2);
    expect(await toggleVote({ nightId, userId: b.id }, opt)).toEqual({ ok: true, voted: false });
    expect((await nightForMember(b.id, nightId))!.options[1].count).toBe(1);
  });

  it("a double tap does not fail", async () => {
    const { b, nightId } = await newNight();
    const opt = (await nightForMember(b.id, nightId))!.options[1].id;
    for (let i = 0; i < 5; i++) {
      const results = await Promise.all([toggleVote({ nightId, userId: b.id }, opt), toggleVote({ nightId, userId: b.id }, opt)]);
      expect(results.every((r) => r.ok)).toBe(true);
    }
  });

  it("a non-member cannot vote as a member, but a signed-in person with the shared link can", async () => {
    const { nightId } = await newNight();
    const outsider = await makeUser("Outsider");
    const v = (await nightForMember((await db.select().from(night))[0].hostId, nightId))!;
    expect(await toggleVote({ nightId, userId: outsider.id }, v.options[0].id)).toEqual({ ok: false, error: "You are not in that group." });
    expect(await toggleVote({ nightId, userId: outsider.id, viaToken: true }, v.options[0].id)).toEqual({ ok: true, voted: true });
    expect((await nightByToken(v.night.publicToken))!.participants.some((p) => p.name === "Outsider")).toBe(true);
  });

  it("guests vote with just a name, and only with their own secret", async () => {
    const { nightId } = await newNight();
    const token = (await db.select().from(night))[0].publicToken;
    expect(await joinAsGuest(token, "   ")).toEqual({ ok: false, error: "Type your name so the others know who voted." });
    expect(await joinAsGuest("nope", "Dana")).toEqual({ ok: false, error: "That link is not valid any more." });
    const g = await joinAsGuest(token, "  Dana   K ");
    if (!g.ok) throw new Error(g.error);
    const view = (await nightByToken(token))!;
    expect(view.participants.find((p) => p.guest)).toMatchObject({ name: "Dana K", guest: true, userId: null });
    expect(await toggleVote({ nightId, guestSecret: g.secret }, view.options[0].id)).toEqual({ ok: true, voted: true });
    expect(await toggleVote({ nightId, guestSecret: "wrong-secret" }, view.options[0].id)).toEqual({ ok: false, error: "Add your name first." });
    expect((await nightByToken(token))!.options[0].count).toBe(2); // host and Dana
  });

  it("guests cannot vote on another night's options", async () => {
    const one = await newNight();
    const token = (await db.select().from(night))[0].publicToken;
    const g = await joinAsGuest(token, "Dana");
    if (!g.ok) throw new Error();
    const k2 = await club();
    const r2 = await createNight(k2.a.id, { groupId: k2.groupId, itemId: k2.film.id, options: k2.opts }, NOW);
    if (!r2.ok) throw new Error();
    const other = (await nightForMember(k2.a.id, r2.id))!;
    expect(await toggleVote({ nightId: one.nightId, guestSecret: g.secret }, other.options[0].id)).toEqual({ ok: false, error: "That time is not part of this night." });
  });

  it("limits how many guests can join", async () => {
    const { } = await newNight();
    const token = (await db.select().from(night))[0].publicToken;
    for (let i = 0; i < MAX_GUESTS; i++) expect((await joinAsGuest(token, `Guest ${i}`)).ok).toBe(true);
    expect(await joinAsGuest(token, "One too many")).toMatchObject({ ok: false });
  });

  it("closes once a time is picked", async () => {
    const { a, b, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    await lockIn(a.id, nightId, v.options[0].id);
    expect(await toggleVote({ nightId, userId: b.id }, v.options[1].id)).toEqual({ ok: false, error: "Voting is closed for this night." });
  });
});

describe("locking in a time", () => {
  it("only the host can pick, and the host plus everyone who voted for it get the night on their plan", async () => {
    const { a, b, c, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    await toggleVote({ nightId, userId: b.id }, v.options[0].id); // Sara votes for the first time
    expect(await lockIn(b.id, nightId, v.options[0].id)).toEqual({ ok: false, error: "Only the person who proposed the night can pick the time." });

    const res = await lockIn(a.id, nightId, v.options[0].id);
    expect(res).toEqual({ ok: true, sessions: 2 });
    const sessions = await db.select().from(planSession);
    expect(sessions.map((s) => s.userId).sort()).toEqual([a.id, b.id].sort());
    expect(sessions[0]).toMatchObject({ title: "Interstellar", category: "movie", durationMin: 170, nightId });
    expect(sessions[0].startsAt.toISOString()).toBe("2026-10-16T17:00:00.000Z");
    expect(await db.select().from(planSession).where(eq(planSession.userId, c.id))).toHaveLength(0);

    const after = (await nightForMember(a.id, nightId))!;
    expect(after.night.status).toBe("set");
    expect(after.chosen?.id).toBe(v.options[0].id);
    expect(after.participants.find((p) => p.userId === b.id)?.rsvp).toBe("going");
    expect(after.participants.find((p) => p.userId === c.id)?.rsvp).toBeNull();
    expect(await lockIn(a.id, nightId, v.options[1].id)).toEqual({ ok: false, error: "A time has already been picked." });
  });

  it("the night shows up in the calendar feed", async () => {
    const { a, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    await lockIn(a.id, nightId, v.options[0].id);
    const feed = await sessionsForFeed(a.id, NOW);
    expect(feed.map((s) => s.title)).toEqual(["Interstellar"]);
  });

  it("keeps a night on the plan even when it overlaps something else", async () => {
    const { a, nightId } = await newNight();
    await db.insert(planSession).values({ userId: a.id, title: "Existing", startsAt: at("2026-10-16T17:30:00Z"), durationMin: 60 });
    const v = (await nightForMember(a.id, nightId))!;
    expect(await lockIn(a.id, nightId, v.options[0].id)).toEqual({ ok: true, sessions: 1 });
    expect(await db.select().from(planSession).where(eq(planSession.userId, a.id))).toHaveLength(2);
  });

  it("an option from another night cannot be picked", async () => {
    const one = await newNight();
    const k2 = await club();
    const r2 = await createNight(k2.a.id, { groupId: k2.groupId, itemId: k2.film.id, options: k2.opts }, NOW);
    if (!r2.ok) throw new Error();
    const other = (await nightForMember(k2.a.id, r2.id))!;
    expect(await lockIn(one.a.id, one.nightId, other.options[0].id)).toEqual({ ok: false, error: "That time is not part of this night." });
  });
});

describe("RSVPs", () => {
  async function lockedNight() {
    const k = await newNight();
    const v = (await nightForMember(k.a.id, k.nightId))!;
    await lockIn(k.a.id, k.nightId, v.options[0].id);
    return k;
  }

  it("someone who did not vote can still say going, and gets the session", async () => {
    const { c, nightId } = await lockedNight();
    expect(await setRsvp({ nightId, userId: c.id }, "going")).toEqual({ ok: true });
    expect(await db.select().from(planSession).where(eq(planSession.userId, c.id))).toHaveLength(1);
    await setRsvp({ nightId, userId: c.id }, "going");
    expect(await db.select().from(planSession).where(eq(planSession.userId, c.id))).toHaveLength(1); // not duplicated
  });

  it("maybe keeps it on the plan, can't takes it off", async () => {
    const { a, nightId } = await lockedNight();
    await setRsvp({ nightId, userId: a.id }, "maybe");
    expect(await db.select().from(planSession).where(eq(planSession.userId, a.id))).toHaveLength(1);
    await setRsvp({ nightId, userId: a.id }, "cant");
    expect(await db.select().from(planSession).where(eq(planSession.userId, a.id))).toHaveLength(0);
    expect((await nightForMember(a.id, nightId))!.participants.find((p) => p.userId === a.id)?.rsvp).toBe("cant");
  });

  it("guests can answer too, without a session", async () => {
    const { nightId } = await lockedNight();
    const token = (await db.select().from(night))[0].publicToken;
    const g = await joinAsGuest(token, "Dana");
    if (!g.ok) throw new Error();
    expect(await setRsvp({ nightId, guestSecret: g.secret }, "going")).toEqual({ ok: true });
    expect((await nightByToken(token))!.participants.find((p) => p.guest)?.rsvp).toBe("going");
    expect(await setRsvp({ nightId, guestSecret: "nope" }, "going")).toEqual({ ok: false, error: "You are not part of this night." });
  });

  it("is not available until a time is picked, and not to outsiders", async () => {
    const { a, nightId } = await newNight();
    expect(await setRsvp({ nightId, userId: a.id }, "going")).toEqual({ ok: false, error: "A time has not been picked yet." });
    const k = await lockedNight();
    const stranger = await makeUser("Stranger");
    expect(await setRsvp({ nightId: k.nightId, userId: stranger.id }, "going")).toEqual({ ok: false, error: "You are not part of this night." });
  });
});

describe("changing plans", () => {
  it("reopening voting takes the night off everyone's plan and clears answers", async () => {
    const { a, b, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    await toggleVote({ nightId, userId: b.id }, v.options[0].id);
    await lockIn(a.id, nightId, v.options[0].id);
    expect(await reopenVoting(b.id, nightId)).toBe(false);
    expect(await reopenVoting(a.id, nightId)).toBe(true);
    expect(await db.select().from(planSession)).toHaveLength(0);
    const after = (await nightForMember(a.id, nightId))!;
    expect(after.night).toMatchObject({ status: "voting", chosenOptionId: null });
    expect(after.participants.every((p) => p.rsvp === null)).toBe(true);
    expect(after.options[0].count).toBe(2); // votes are kept
  });

  it("cancelling removes the sessions and only the host can", async () => {
    const { a, b, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    await lockIn(a.id, nightId, v.options[0].id);
    expect(await cancelNight(b.id, nightId)).toBe(false);
    expect(await cancelNight(a.id, nightId)).toBe(true);
    expect(await db.select().from(planSession)).toHaveLength(0);
    expect((await nightForMember(a.id, nightId))!.night.status).toBe("cancelled");
  });

  it("marking it done needs a picked time and the host", async () => {
    const { a, b, nightId } = await newNight();
    expect(await markNightDone(a.id, nightId)).toBe(false);
    const v = (await nightForMember(a.id, nightId))!;
    await lockIn(a.id, nightId, v.options[0].id);
    expect(await markNightDone(b.id, nightId)).toBe(false);
    expect(await markNightDone(a.id, nightId)).toBe(true);
  });

  it("deleting the group removes its nights and unlinks the sessions", async () => {
    const { a, groupId, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    await lockIn(a.id, nightId, v.options[0].id);
    await db.delete(friendGroup).where(eq(friendGroup.id, groupId));
    expect(await db.select().from(night)).toHaveLength(0);
    expect(await db.select().from(nightVote)).toHaveLength(0);
    expect(await db.select().from(nightParticipant)).toHaveLength(0);
    const [s] = await db.select().from(planSession);
    expect(s.nightId).toBeNull(); // the person keeps the session
  });
});

describe("finishing the night", () => {
  it("each person marks their own part done, which watches the movie and counts the time", async () => {
    const k = await newNight({ units: 1 });
    const { a, b } = k;
    for (const u of [a, b]) {
      const row = await upsertItemEntry(u.id, k.film.id);
      expect(row.status).toBe("want");
    }
    const v = (await nightForMember(a.id, k.nightId))!;
    await toggleVote({ nightId: k.nightId, userId: b.id }, v.options[0].id);
    await lockIn(a.id, k.nightId, v.options[0].id);
    const mine = (await db.select().from(planSession).where(eq(planSession.userId, b.id)))[0];
    expect(mine.units).toBe(1);
    const res = await completeSession(b.id, mine.id);
    expect(res).toMatchObject({ finishedNow: true });
    const [e] = await db.select().from(entry).where(and(eq(entry.userId, b.id), eq(entry.itemId, k.film.id)));
    expect(e).toMatchObject({ status: "done", progress: 1 });
    // Yousef has not marked his part yet.
    const [ea] = await db.select().from(entry).where(and(eq(entry.userId, a.id), eq(entry.itemId, k.film.id)));
    expect(ea.status).toBe("want");
  });

  it("someone without the item on their list still gets the session, just without progress", async () => {
    const k = await newNight({ units: 1 });
    const v = (await nightForMember(k.a.id, k.nightId))!;
    await lockIn(k.a.id, k.nightId, v.options[0].id);
    const [s] = await db.select().from(planSession).where(eq(planSession.userId, k.a.id));
    expect(s).toMatchObject({ itemId: null, units: null });
  });

  it("an episode night covers several episodes", async () => {
    const k = await club();
    const r = await createNight(k.a.id, { groupId: k.groupId, itemId: k.show.id, options: [{ startsAt: at("2026-10-16T17:00:00Z"), durationMin: 72 }], units: 3 }, NOW);
    if (!r.ok) throw new Error();
    await upsertItemEntry(k.a.id, k.show.id);
    await lockIn(k.a.id, r.id, (await nightForMember(k.a.id, r.id))!.options[0].id);
    const [s] = await db.select().from(planSession);
    expect(s).toMatchObject({ title: "Frieren · 3 episodes", units: 3 });
    await completeSession(k.a.id, s.id);
    const [e] = await db.select().from(entry).where(and(eq(entry.userId, k.a.id), eq(entry.itemId, k.show.id)));
    expect(e.progress).toBe(3);
  });
});

async function upsertItemEntry(userId: string, itemId: string) {
  const { entry: e } = await addEntry(userId, itemId);
  return e;
}

describe("suggestOptions", () => {
  it("uses the host's usual free time, skipping days with none", async () => {
    const me = await makeUser("Yousef");
    // Free Fridays and Saturdays from 20:00 to 23:00.
    await db.insert(freeWindow).values([5, 6].map((weekday) => ({ userId: me.id, weekday, startMin: 1200, endMin: 1380 })));
    const out = await suggestOptions(me.id, "UTC", 120, NOW); // Sunday 11 Oct
    expect(out.map((d) => d.toISOString())).toEqual(["2026-10-16T20:00:00.000Z", "2026-10-17T20:00:00.000Z"]);
  });
  it("skips windows that are too short for the night", async () => {
    const me = await makeUser("Yousef");
    await db.insert(freeWindow).values({ userId: me.id, weekday: 5, startMin: 1200, endMin: 1260 });
    const out = await suggestOptions(me.id, "UTC", 120, NOW);
    expect(out).toHaveLength(3); // falls back to evenings in the next days
    expect(out[0].toISOString()).toBe("2026-10-12T20:00:00.000Z");
  });
  it("falls back to the next three evenings with no free time set", async () => {
    const me = await makeUser("Yousef");
    expect((await suggestOptions(me.id, "UTC", 90, NOW)).map((d) => d.toISOString())).toEqual(["2026-10-12T20:00:00.000Z", "2026-10-13T20:00:00.000Z", "2026-10-14T20:00:00.000Z"]);
  });
  it("does not suggest a time that is about to start", async () => {
    const me = await makeUser("Yousef");
    await db.insert(freeWindow).values({ userId: me.id, weekday: 0, startMin: 12 * 60 + 30, endMin: 23 * 60 }); // Sunday from 12:30; now is 12:00
    const out = await suggestOptions(me.id, "UTC", 60, NOW);
    expect(out[0].toISOString()).not.toBe("2026-10-11T12:30:00.000Z");
  });
});

describe("profile lookups used for names", () => {
  it("shows display names, not emails", async () => {
    const { a, nightId } = await newNight();
    const v = (await nightForMember(a.id, nightId))!;
    expect(JSON.stringify(v)).not.toContain("@example.com");
    expect((await db.select().from(profile)).length).toBe(3);
  });
});
