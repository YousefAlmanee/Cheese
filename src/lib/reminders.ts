import { and, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { planSession, profile, pushSubscription } from "@/db/schema";
import { formatMinutes } from "./length";
import { sendToUser } from "./push";
import { timeLabel } from "./time";

const GRACE_MS = 10 * 60_000;

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

  let due = 0;
  let sent = 0;
  for (const { s, zone, lead } of candidates) {
    if (s.startsAt.getTime() - now.getTime() > lead * 60_000) continue; // not yet in this person's window
    due++;
    const [claimed] = await db.update(planSession).set({ remindedAt: now }).where(and(eq(planSession.id, s.id), sql`${planSession.remindedAt} is null`)).returning();
    if (!claimed) continue; // another run took it
    const mins = Math.max(0, Math.round((s.startsAt.getTime() - now.getTime()) / 60_000));
    const res = await sendToUser(s.userId, {
      title: s.title,
      body: `${mins <= 1 ? "Starting now" : `Starts in ${formatMinutes(mins)}`} · ${timeLabel(s.startsAt, zone)} · ${formatMinutes(s.durationMin)}`,
      url: `/plan/session/${s.id}`,
      tag: s.id,
    });
    if (res.sent > 0) sent++;
    else await db.update(planSession).set({ remindedAt: null }).where(eq(planSession.id, s.id));
  }
  return { due, sent };
}
