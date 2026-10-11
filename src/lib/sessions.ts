import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, planSession, progressLog, type Category } from "@/db/schema";
import { changeProgress } from "./entries";

export type BookInput = {
  itemId?: string | null;
  title: string;
  category?: Category | null;
  startsAt: Date;
  durationMin: number;
  units?: number | null;
  note?: string | null;
  nightId?: string | null;
};

export type BookResult = { ok: true; session: typeof planSession.$inferSelect } | { ok: false; error: string };

/** Sessions of this person that overlap the given span and are not done. */
export async function overlapping(userId: string, start: Date, end: Date, ignoreId?: string) {
  const rows = await db
    .select()
    .from(planSession)
    .where(
      and(
        eq(planSession.userId, userId),
        eq(planSession.done, false),
        lt(planSession.startsAt, end),
        sql`${planSession.startsAt} + make_interval(mins => ${planSession.durationMin}) > ${start}`,
      ),
    );
  return rows.filter((r) => r.id !== ignoreId);
}

export async function bookSession(userId: string, input: BookInput, now = new Date(), opts: { allowOverlap?: boolean } = {}): Promise<BookResult> {
  const title = input.title.trim().slice(0, 160);
  if (!title) return { ok: false, error: "Give the session a title." };
  if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 720) {
    return { ok: false, error: "Pick a length between 5 minutes and 12 hours." };
  }
  const end = new Date(input.startsAt.getTime() + input.durationMin * 60_000);
  if (end.getTime() < now.getTime()) return { ok: false, error: "That time has already passed." };
  if (input.itemId) {
    const own = await db.query.entry.findFirst({ where: and(eq(entry.userId, userId), eq(entry.itemId, input.itemId)) });
    if (!own) return { ok: false, error: "That item is not in your library." };
  }
  const clash = opts.allowOverlap ? [] : await overlapping(userId, input.startsAt, end);
  if (clash.length) return { ok: false, error: `You already have “${clash[0].title}” at that time.` };

  const [session] = await db
    .insert(planSession)
    .values({
      userId,
      itemId: input.itemId ?? null,
      title,
      category: input.category ?? null,
      startsAt: input.startsAt,
      durationMin: input.durationMin,
      units: input.units ?? null,
      note: input.note?.trim().slice(0, 500) || null,
      nightId: input.nightId ?? null,
    })
    .returning();
  return { ok: true, session };
}

/** Marks a session as done once. Applies its planned progress, or logs its length as time if it had none. */
export async function completeSession(userId: string, id: string) {
  const s = await db.query.planSession.findFirst({ where: and(eq(planSession.id, id), eq(planSession.userId, userId)) });
  if (!s) return null;
  if (s.done) return { session: s, entryId: null as string | null, finishedNow: false };
  // Claim the session first so a double tap cannot count it twice.
  const [claimed] = await db.update(planSession).set({ done: true }).where(and(eq(planSession.id, id), eq(planSession.done, false))).returning();
  if (!claimed) return { session: s, entryId: null as string | null, finishedNow: false };

  // If applying the progress fails, give the session back so tapping again retries instead of silently losing it.
  try {
    const own = s.itemId ? await db.query.entry.findFirst({ where: and(eq(entry.userId, userId), eq(entry.itemId, s.itemId)) }) : null;
    let finishedNow = false;
    if (own && s.units) {
      const res = await changeProgress(userId, own.id, { add: s.units });
      finishedNow = res?.finishedNow ?? false;
    } else {
      await db.insert(progressLog).values({ userId, entryId: own?.id ?? null, deltaUnits: 0, minutes: s.durationMin });
    }
    return { session: claimed, entryId: own?.id ?? null, finishedNow };
  } catch (e) {
    await db.update(planSession).set({ done: false }).where(eq(planSession.id, id));
    throw e;
  }
}

export async function removeSession(userId: string, id: string) {
  const res = await db.delete(planSession).where(and(eq(planSession.id, id), eq(planSession.userId, userId))).returning({ id: planSession.id });
  return res.length > 0;
}

export async function getOwnSession(userId: string, id: string) {
  const rows = await db
    .select({ s: planSession, i: item })
    .from(planSession)
    .leftJoin(item, eq(planSession.itemId, item.id))
    .where(and(eq(planSession.id, id), eq(planSession.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Upcoming sessions for the calendar feed: a week back to a quarter ahead. */
export async function sessionsForFeed(userId: string, now = new Date()) {
  return db
    .select()
    .from(planSession)
    .where(and(eq(planSession.userId, userId), eq(planSession.done, false), gte(planSession.startsAt, new Date(now.getTime() - 7 * 86_400_000)), lt(planSession.startsAt, new Date(now.getTime() + 90 * 86_400_000))))
    .orderBy(asc(planSession.startsAt));
}
