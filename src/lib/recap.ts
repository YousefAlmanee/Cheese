import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { entry, item, planSession, profile, progressLog } from "@/db/schema";
import { formatMinutes } from "./length";
import { notify } from "./notifications";
import { weekBounds } from "./time";

/** The recap goes out on Sunday at or after this local hour. */
export const RECAP_HOUR = 18;
/** Weeks run Monday to Sunday for the recap, so Sunday evening is the end of the week being summed up. */
const MONDAY = 1;

export type Recap = {
  /** Start of the week (Monday, local midnight) and the moment the numbers were taken. */
  from: Date;
  to: Date;
  minutes: number;
  finished: string[];
  sessionsPlanned: number;
  sessionsDone: number;
};

export function hasActivity(r: Recap): boolean {
  return r.minutes > 0 || r.finished.length > 0 || r.sessionsDone > 0;
}

/** This week so far (Monday to `now`) for one person: time logged, titles finished, planned sessions kept. */
export async function weeklyRecap(userId: string, zone: string, now = new Date()): Promise<Recap> {
  const { start } = weekBounds(now, zone, MONDAY);
  const [logged] = await db
    .select({ n: sql<number>`coalesce(sum(${progressLog.minutes}), 0)::int` })
    .from(progressLog)
    .where(and(eq(progressLog.userId, userId), gte(progressLog.at, start), lte(progressLog.at, now)));
  const finished = await db
    .select({ title: item.title })
    .from(entry)
    .innerJoin(item, eq(entry.itemId, item.id))
    .where(and(eq(entry.userId, userId), eq(entry.status, "done"), gte(entry.finishedAt, start), lte(entry.finishedAt, now)))
    .orderBy(entry.finishedAt);
  const [sessions] = await db
    .select({
      planned: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${planSession.done})::int`,
    })
    .from(planSession)
    .where(and(eq(planSession.userId, userId), gte(planSession.startsAt, start), lte(planSession.startsAt, now)));
  return {
    from: start,
    to: now,
    // An undone tap is stored as negative minutes, so a week of only undos should read as zero, not negative.
    minutes: Math.max(0, logged?.n ?? 0),
    finished: finished.map((f) => f.title),
    sessionsPlanned: sessions?.planned ?? 0,
    sessionsDone: sessions?.done ?? 0,
  };
}

/** One short line per fact, for the notification body. */
export function recapSummary(r: Recap): string {
  const parts: string[] = [];
  if (r.minutes > 0) parts.push(`${formatMinutes(r.minutes)} logged`);
  if (r.finished.length === 1) parts.push(`finished ${r.finished[0]}`);
  else if (r.finished.length > 1) parts.push(`finished ${r.finished.length} titles`);
  if (r.sessionsPlanned > 0) parts.push(`${r.sessionsDone} of ${r.sessionsPlanned} planned sessions done`);
  return parts.join(" · ");
}

/** True from Sunday 18:00 until the end of Sunday in the person's timezone. */
export function isRecapTime(now: Date, zone: string): boolean {
  const local = DateTime.fromJSDate(now, { zone });
  return local.isValid && local.weekday === 7 && local.hour >= RECAP_HOUR;
}

/**
 * Sends the weekly recap to everyone it is due for. Safe to run every few minutes, and safe to run twice at once:
 * each person is claimed (lastRecapAt set) before anything is sent, so a week never produces two.
 * A week with no activity sends nothing and is not claimed, so activity later that Sunday still gets a recap.
 */
export async function sendWeeklyRecaps(now = new Date()): Promise<{ checked: number; sent: number }> {
  // Anyone recapped within the last six days has this week's already, so they are not even looked at.
  const people = await db
    .select({ userId: profile.userId, zone: profile.timezone })
    .from(profile)
    .where(and(eq(profile.recapEnabled, true), or(isNull(profile.lastRecapAt), lt(profile.lastRecapAt, new Date(now.getTime() - 6 * 24 * 3600_000)))));

  let checked = 0;
  let sent = 0;
  for (const { userId, zone } of people) {
    if (!isRecapTime(now, zone)) continue;
    checked++;
    const recap = await weeklyRecap(userId, zone, now);
    if (!hasActivity(recap)) continue;
    const [claimed] = await db
      .update(profile)
      .set({ lastRecapAt: now })
      .where(and(eq(profile.userId, userId), or(isNull(profile.lastRecapAt), lt(profile.lastRecapAt, recap.from))))
      .returning({ userId: profile.userId });
    if (!claimed) continue; // another run took it
    await notify({ userId, type: "weekly_recap", title: "Your week", body: recapSummary(recap), url: "/recap" });
    sent++;
  }
  return { checked, sent };
}
