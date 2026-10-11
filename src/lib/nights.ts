import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
  friendGroup, freeWindow, groupMember, item, night, nightOption, nightParticipant, nightVote, planSession, profile,
  type Rsvp,
} from "@/db/schema";
import { isMember } from "./friends";
import { localInstant } from "./freetime";
import { bookSession } from "./sessions";
import { randomToken } from "./tokens";

export const MAX_OPTIONS = 6;
export const MAX_GUESTS = 30;

export type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

export type OptionInput = { startsAt: Date; durationMin: number };

export type CreateInput = { groupId: string; itemId: string; options: OptionInput[]; units?: number | null; note?: string | null };

/** Creates a night with its time options. Everyone in the group is invited; the host's own votes are filled in. */
export async function createNight(hostId: string, input: CreateInput, now = new Date()): Promise<Ok<{ id: string }> | Fail> {
  if (!(await isMember(hostId, input.groupId))) return { ok: false, error: "You are not in that group." };
  const [it] = await db.select().from(item).where(eq(item.id, input.itemId));
  if (!it) return { ok: false, error: "That item does not exist." };

  const seen = new Set<number>();
  const options = input.options.filter((o) => {
    const t = o.startsAt.getTime();
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  if (options.length === 0) return { ok: false, error: "Suggest at least one time." };
  if (options.length > MAX_OPTIONS) return { ok: false, error: `Suggest up to ${MAX_OPTIONS} times.` };
  for (const o of options) {
    if (!Number.isInteger(o.durationMin) || o.durationMin < 5 || o.durationMin > 720) return { ok: false, error: "Pick a length between 5 minutes and 12 hours." };
    if (o.startsAt.getTime() < now.getTime() - 30 * 60_000) return { ok: false, error: "Those times have already passed." };
  }

  const id = await db.transaction(async (tx) => {
    const [n] = await tx
      .insert(night)
      // A movie is always one watch, whatever the form sent.
      .values({ groupId: input.groupId, hostId, itemId: input.itemId, units: it.unit === "watch" ? 1 : (input.units ?? null), note: input.note?.trim().slice(0, 500) || null, publicToken: randomToken() })
      .returning();
    const opts = await tx.insert(nightOption).values(options.map((o) => ({ nightId: n.id, startsAt: o.startsAt, durationMin: o.durationMin }))).returning();
    const members = await tx.select({ userId: groupMember.userId }).from(groupMember).where(eq(groupMember.groupId, input.groupId));
    const parts = await tx.insert(nightParticipant).values(members.map((m) => ({ nightId: n.id, userId: m.userId }))).returning();
    const host = parts.find((p) => p.userId === hostId);
    if (host) await tx.insert(nightVote).values(opts.map((o) => ({ optionId: o.id, participantId: host.id })));
    return n.id;
  });
  return { ok: true, id };
}

/* ---------- Reading a night ---------- */

export type ParticipantView = { id: string; userId: string | null; name: string; avatarTone: number; guest: boolean; rsvp: Rsvp | null };

export type NightView = {
  night: typeof night.$inferSelect;
  item: typeof item.$inferSelect;
  groupName: string | null;
  host: { userId: string; name: string; timezone: string };
  options: { id: string; startsAt: Date; durationMin: number; voterIds: string[]; count: number }[];
  participants: ParticipantView[];
  chosen: { id: string; startsAt: Date; durationMin: number } | null;
};

function toneOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return (Math.abs(h) % 4) + 1;
}

async function viewOf(n: typeof night.$inferSelect): Promise<NightView> {
  const [[it], [g], [host], opts, parts] = await Promise.all([
    db.select().from(item).where(eq(item.id, n.itemId)),
    db.select().from(friendGroup).where(eq(friendGroup.id, n.groupId)),
    db.select({ userId: profile.userId, name: profile.displayName, timezone: profile.timezone }).from(profile).where(eq(profile.userId, n.hostId)),
    db.select().from(nightOption).where(eq(nightOption.nightId, n.id)).orderBy(asc(nightOption.startsAt)),
    db
      .select({ p: nightParticipant, name: profile.displayName, tone: profile.avatarTone })
      .from(nightParticipant)
      .leftJoin(profile, eq(nightParticipant.userId, profile.userId))
      .where(eq(nightParticipant.nightId, n.id))
      .orderBy(asc(nightParticipant.createdAt)),
  ]);
  const votes = opts.length ? await db.select().from(nightVote).where(inArray(nightVote.optionId, opts.map((o) => o.id))) : [];
  const participants: ParticipantView[] = parts.map(({ p, name, tone }) => ({
    id: p.id,
    userId: p.userId,
    name: p.userId ? (name ?? "Someone") : (p.guestName ?? "Guest"),
    avatarTone: p.userId ? (tone ?? 1) : toneOf(p.guestName ?? "Guest"),
    guest: !p.userId,
    rsvp: p.rsvp,
  }));
  const options = opts.map((o) => {
    const voterIds = votes.filter((v) => v.optionId === o.id).map((v) => v.participantId);
    return { id: o.id, startsAt: o.startsAt, durationMin: o.durationMin, voterIds, count: voterIds.length };
  });
  const chosen = options.find((o) => o.id === n.chosenOptionId) ?? null;
  return { night: n, item: it, groupName: g?.name ?? null, host, options, participants, chosen: chosen ? { id: chosen.id, startsAt: chosen.startsAt, durationMin: chosen.durationMin } : null };
}

/** The full view for someone in the group. Anyone else gets null. */
export async function nightForMember(userId: string, nightId: string): Promise<NightView | null> {
  const [n] = await db.select().from(night).where(eq(night.id, nightId));
  if (!n || !(await isMember(userId, n.groupId))) return null;
  return viewOf(n);
}

/** The view behind the shared link. The unguessable token is the only credential. */
export async function nightByToken(token: string): Promise<NightView | null> {
  const [n] = await db.select().from(night).where(eq(night.publicToken, token));
  return n ? viewOf(n) : null;
}

export async function upcomingNights(groupId: string, limit = 3) {
  return db
    .select({ n: night, i: item, startsAt: nightOption.startsAt })
    .from(night)
    .innerJoin(item, eq(night.itemId, item.id))
    .leftJoin(nightOption, eq(night.chosenOptionId, nightOption.id))
    .where(and(eq(night.groupId, groupId), inArray(night.status, ["voting", "set"])))
    .orderBy(sql`${night.createdAt} desc`)
    .limit(limit);
}

/* ---------- People taking part ---------- */

export type Who = { userId: string } | { guestSecret: string };

export async function participantOf(nightId: string, who: Who) {
  if ("userId" in who) return db.query.nightParticipant.findFirst({ where: and(eq(nightParticipant.nightId, nightId), eq(nightParticipant.userId, who.userId)) });
  return db.query.nightParticipant.findFirst({ where: and(eq(nightParticipant.nightId, nightId), eq(nightParticipant.guestSecret, who.guestSecret)) });
}

/** A signed-in person who opens the shared link becomes a participant, whether or not they are in the group. */
async function ensureUserParticipant(nightId: string, userId: string) {
  const existing = await participantOf(nightId, { userId });
  if (existing) return existing;
  const [created] = await db.insert(nightParticipant).values({ nightId, userId }).onConflictDoNothing().returning();
  return created ?? (await participantOf(nightId, { userId }))!;
}

export async function joinAsGuest(token: string, nameInput: string): Promise<Ok<{ secret: string; participantId: string }> | Fail> {
  const name = nameInput.trim().replace(/\s+/g, " ").slice(0, 30);
  if (!name) return { ok: false, error: "Type your name so the others know who voted." };
  const [n] = await db.select().from(night).where(eq(night.publicToken, token));
  if (!n) return { ok: false, error: "That link is not valid any more." };
  const count = await db.select({ c: sql<number>`count(*)::int` }).from(nightParticipant).where(and(eq(nightParticipant.nightId, n.id), sql`${nightParticipant.guestName} is not null`));
  if ((count[0]?.c ?? 0) >= MAX_GUESTS) return { ok: false, error: "This night already has as many guests as it can take." };
  const secret = randomToken();
  const [p] = await db.insert(nightParticipant).values({ nightId: n.id, guestName: name, guestSecret: secret }).returning();
  return { ok: true, secret, participantId: p.id };
}

/* ---------- Voting ---------- */

export type VoteVia = { nightId: string } & ({ userId: string; viaToken?: boolean } | { guestSecret: string });

/** Turns one vote on or off. Members vote on their own night; the shared link also lets any signed-in person or guest in. */
export async function toggleVote(via: VoteVia, optionId: string): Promise<Ok<{ voted: boolean }> | Fail> {
  const [n] = await db.select().from(night).where(eq(night.id, via.nightId));
  if (!n) return { ok: false, error: "That night does not exist." };
  if (n.status !== "voting") return { ok: false, error: "Voting is closed for this night." };
  const [opt] = await db.select().from(nightOption).where(and(eq(nightOption.id, optionId), eq(nightOption.nightId, n.id)));
  if (!opt) return { ok: false, error: "That time is not part of this night." };

  let participant;
  if ("guestSecret" in via) {
    participant = await participantOf(n.id, { guestSecret: via.guestSecret });
    if (!participant) return { ok: false, error: "Add your name first." };
  } else if (via.viaToken) {
    participant = await ensureUserParticipant(n.id, via.userId);
  } else {
    if (!(await isMember(via.userId, n.groupId))) return { ok: false, error: "You are not in that group." };
    participant = await ensureUserParticipant(n.id, via.userId);
  }

  const mine = and(eq(nightVote.optionId, optionId), eq(nightVote.participantId, participant.id));
  // Delete first and insert only if there was nothing to delete. A double tap would otherwise both see
  // "no vote yet" and the second insert would hit the primary key.
  const removed = await db.delete(nightVote).where(mine).returning({ id: nightVote.optionId });
  if (removed.length) return { ok: true, voted: false };
  await db.insert(nightVote).values({ optionId, participantId: participant.id }).onConflictDoNothing();
  return { ok: true, voted: true };
}

/* ---------- Locking in a time, RSVPs, and what happens after ---------- */

async function hostNight(hostId: string, nightId: string) {
  const [n] = await db.select().from(night).where(and(eq(night.id, nightId), eq(night.hostId, hostId)));
  return n ?? null;
}

function sessionTitle(title: string, units: number | null, unit: string): string {
  if (!units || units <= 0) return title;
  const label = unit === "episode" ? (units === 1 ? "episode" : "episodes") : unit === "chapter" ? (units === 1 ? "chapter" : "chapters") : null;
  return label ? `${title} · ${units} ${label}` : title;
}

async function addNightSession(userId: string, n: typeof night.$inferSelect, it: typeof item.$inferSelect, start: Date, durationMin: number) {
  const existing = await db.query.planSession.findFirst({ where: and(eq(planSession.userId, userId), eq(planSession.nightId, n.id)) });
  if (existing) return existing;
  const own = await db.query.entry.findFirst({ where: (e, { and: a, eq: q }) => a(q(e.userId, userId), q(e.itemId, it.id)) });
  const res = await bookSession(
    userId,
    { itemId: own ? it.id : null, title: sessionTitle(it.title, n.units, it.unit), category: it.category, startsAt: start, durationMin, units: own ? n.units : null, nightId: n.id },
    new Date(0), // a night that was already agreed stays on the plan even if the time has just passed
    { allowOverlap: true },
  );
  return res.ok ? res.session : null;
}

/** Host picks the winning time. It lands on the plan of the host and everyone who voted for it. */
export async function lockIn(hostId: string, nightId: string, optionId: string): Promise<Ok<{ sessions: number }> | Fail> {
  const n = await hostNight(hostId, nightId);
  if (!n) return { ok: false, error: "Only the person who proposed the night can pick the time." };
  if (n.status !== "voting") return { ok: false, error: "A time has already been picked." };
  const [opt] = await db.select().from(nightOption).where(and(eq(nightOption.id, optionId), eq(nightOption.nightId, nightId)));
  if (!opt) return { ok: false, error: "That time is not part of this night." };
  const [it] = await db.select().from(item).where(eq(item.id, n.itemId));

  const voters = await db
    .select({ id: nightParticipant.id, userId: nightParticipant.userId })
    .from(nightVote)
    .innerJoin(nightParticipant, eq(nightVote.participantId, nightParticipant.id))
    .where(eq(nightVote.optionId, optionId));
  const hostPart = await participantOf(nightId, { userId: hostId });
  const going = new Map(voters.map((v) => [v.id, v.userId]));
  if (hostPart) going.set(hostPart.id, hostId);

  await db.update(night).set({ status: "set", chosenOptionId: optionId }).where(eq(night.id, nightId));
  if (going.size) await db.update(nightParticipant).set({ rsvp: "going" }).where(inArray(nightParticipant.id, [...going.keys()]));
  let sessions = 0;
  for (const userId of new Set([...going.values()].filter((u): u is string => Boolean(u)))) {
    if (await addNightSession(userId, n, it, opt.startsAt, opt.durationMin)) sessions++;
  }
  return { ok: true, sessions };
}

/** Going and Maybe keep the night on your plan; Can't takes it off. Only works once a time is picked. */
export async function setRsvp(via: { nightId: string } & Who, status: Rsvp): Promise<Ok | Fail> {
  const [n] = await db.select().from(night).where(eq(night.id, via.nightId));
  if (!n) return { ok: false, error: "That night does not exist." };
  if (n.status !== "set" || !n.chosenOptionId) return { ok: false, error: "A time has not been picked yet." };
  const { nightId: _ignored, ...who } = via;
  const p = await participantOf(n.id, who as Who);
  if (!p) return { ok: false, error: "You are not part of this night." };
  await db.update(nightParticipant).set({ rsvp: status }).where(eq(nightParticipant.id, p.id));
  if (p.userId) {
    if (status === "cant") {
      await db.delete(planSession).where(and(eq(planSession.userId, p.userId), eq(planSession.nightId, n.id)));
    } else {
      const [opt] = await db.select().from(nightOption).where(eq(nightOption.id, n.chosenOptionId));
      const [it] = await db.select().from(item).where(eq(item.id, n.itemId));
      await addNightSession(p.userId, n, it, opt.startsAt, opt.durationMin);
    }
  }
  return { ok: true };
}

/** Back to voting, for when the chosen time falls through. Takes the night off everyone's plan. */
export async function reopenVoting(hostId: string, nightId: string): Promise<boolean> {
  const n = await hostNight(hostId, nightId);
  if (!n || n.status === "voting") return false;
  await db.transaction(async (tx) => {
    await tx.delete(planSession).where(eq(planSession.nightId, nightId));
    await tx.update(nightParticipant).set({ rsvp: null }).where(eq(nightParticipant.nightId, nightId));
    await tx.update(night).set({ status: "voting", chosenOptionId: null }).where(eq(night.id, nightId));
  });
  return true;
}

export async function cancelNight(hostId: string, nightId: string): Promise<boolean> {
  const n = await hostNight(hostId, nightId);
  if (!n) return false;
  await db.transaction(async (tx) => {
    await tx.delete(planSession).where(and(eq(planSession.nightId, nightId), eq(planSession.done, false)));
    await tx.update(night).set({ status: "cancelled" }).where(eq(night.id, nightId));
  });
  return true;
}

export async function markNightDone(hostId: string, nightId: string): Promise<boolean> {
  const n = await hostNight(hostId, nightId);
  if (!n || n.status !== "set") return false;
  await db.update(night).set({ status: "done" }).where(eq(night.id, nightId));
  return true;
}

/* ---------- Suggested times ---------- */

/** Up to three times for a new night, taken from the host's own usual free time over the next week. */
export async function suggestOptions(userId: string, zone: string, durationMin: number, now = new Date()): Promise<Date[]> {
  const windows = await db.select().from(freeWindow).where(eq(freeWindow.userId, userId));
  const out: Date[] = [];
  const today = DateTime.fromJSDate(now, { zone }).startOf("day");
  for (let i = 0; i < 8 && out.length < 3; i++) {
    const day = today.plus({ days: i });
    const iso = day.toISODate() as string;
    const weekday = day.weekday % 7;
    for (const w of windows.filter((x) => x.weekday === weekday).sort((a, b) => a.startMin - b.startMin)) {
      if (w.endMin - w.startMin < durationMin) continue;
      const start = new Date(localInstant(zone, iso, w.startMin));
      if (start.getTime() > now.getTime() + 3600_000) {
        out.push(start);
        break;
      }
    }
  }
  if (out.length === 0) {
    for (let i = 1; i <= 3; i++) out.push(new Date(localInstant(zone, today.plus({ days: i }).toISODate() as string, 20 * 60)));
  }
  return out;
}
