import { and, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { planSession, profile, pushSubscription } from "@/db/schema";
import { formatMinutes } from "./length";
import { sendToUser } from "./push";
import { timeLabel } from "./time";

const GRACE_MS = 10 * 60_000;
const BATCH = 10;

/**
 * Sends a reminder for every session that is coming up within its owner's lead time and has not been reminded about.
 * Safe to run every few minutes, and safe to run twice at once: each session is claimed before it is sent.
 * If nothing could be delivered the claim is released, so the next run tries again until the grace window ends.
 */
export async function sendDueReminders(now = new Date()): Promise<{ due: number; sent: number }> {
  const maxLead = 60 * 60_000;
  const candidates = await db
    .select({ s: planSession, zone: profile.timezone, lead: profile.reminderLeadMin })
    .from(planSession)
    .innerJoin(profile, eq(planSession.userId, profile.userId))
    .where(
      and(
        eq(planSession.done, false),
        sql`${planSession.remindedAt} is null`,
        gt(planSession.startsAt, new Date(now.getTime() - GRACE_MS)),
        lte(planSession.startsAt, new Date(now.getTime() + maxLead)),
        gte(profile.reminderLeadMin, 1),
        sql`exists (select 1 from ${pushSubscription} where ${pushSubscription.userId} = ${planSession.userId})`,
      ),
    );

  const inWindow = candidates.filter(({ s, lead }) => s.startsAt.getTime() - now.getTime() <= lead * 60_000); // the rest are not yet in this person's window
  let sent = 0;
  // A few at a time, so one slow push service cannot hold up everyone else's reminder.
  for (let i = 0; i < inWindow.length; i += BATCH) {
    const results = await Promise.allSettled(inWindow.slice(i, i + BATCH).map((c) => remind(c, now)));
    for (const r of results) {
      if (r.status === "fulfilled") sent += r.value ? 1 : 0;
      else console.error("reminder failed", r.reason);
    }
  }
  return { due: inWindow.length, sent };
}

/** Claims one session and sends its reminder. True when at least one device got it. */
async function remind({ s, zone }: { s: typeof planSession.$inferSelect; zone: string }, now: Date): Promise<boolean> {
  const [claimed] = await db.update(planSession).set({ remindedAt: now }).where(and(eq(planSession.id, s.id), sql`${planSession.remindedAt} is null`)).returning();
  if (!claimed) return false; // another run took it
  try {
    const mins = Math.max(0, Math.round((s.startsAt.getTime() - now.getTime()) / 60_000));
    // A reminder is worthless once the session has started, so an offline phone should not get it an hour late.
    const ttlSec = Math.min(60 * 60, Math.max(60, Math.round((s.startsAt.getTime() - now.getTime()) / 1000)));
    const res = await sendToUser(
      s.userId,
      {
        title: s.title,
        body: `${mins <= 1 ? "Starting now" : `Starts in ${formatMinutes(mins)}`} · ${timeLabel(s.startsAt, zone)} · ${formatMinutes(s.durationMin)}`,
        url: `/plan/session/${s.id}`,
        tag: s.id,
      },
      ttlSec,
    );
    if (res.sent > 0) return true;
  } catch (e) {
    console.error("reminder failed", e);
  }
  // Nothing was delivered: release the claim so the next run tries again.
  await db.update(planSession).set({ remindedAt: null }).where(eq(planSession.id, s.id));
  return false;
}
