import { and, asc, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { entry, item, planSession, type Category } from "@/db/schema";
import { minutesBetween } from "./entries";
import { relativeDay, timeLabel, weekBounds } from "./time";
import type { Candidate } from "./suggest";
import { nextUpText } from "./suggest";

/** Everything that could still be done: Want to, In progress and Paused. */
export async function loadCandidates(userId: string): Promise<Candidate[]> {
  const rows = await db
    .select({ e: entry, i: item })
    .from(entry)
    .innerJoin(item, eq(entry.itemId, item.id))
    .where(and(eq(entry.userId, userId), inArray(entry.status, ["want", "in_progress", "paused"])));
  return rows.map(({ e, i }) => ({
    entryId: e.id,
    itemId: i.id,
    title: i.title,
    category: i.category,
    coverUrl: i.coverUrl,
    status: e.status,
    priority: e.priority,
    progress: e.progress,
    unit: i.unit,
    totalUnits: e.totalOverride ?? i.totalUnits,
    unitSeconds: i.unitSeconds,
    lastProgressAt: e.lastProgressAt,
  }));
}

export type Spotlight = {
  entryId: string;
  title: string;
  category: Category;
  coverUrl: string | null;
  kicker: string;
  line: string;
  status: Candidate["status"];
  unit: Candidate["unit"];
  /** Whether the next tap is "+1" style progress (false for a movie that is not started). */
  plannedAt: Date | null;
};

export type HomeData = {
  goalMinutes: number;
  spentMinutes: number;
  spotlight: Spotlight | null;
  more: Candidate[];
  total: number;
};

const byRecent = (a: Candidate, b: Candidate) => (b.lastProgressAt?.getTime() ?? 0) - (a.lastProgressAt?.getTime() ?? 0);

export async function loadHome(userId: string, zone: string, goalMinutes: number, category: Category | undefined, now = new Date()): Promise<HomeData> {
  const { start, end } = weekBounds(now, zone, 0);
  const [all, spent, next] = await Promise.all([
    loadCandidates(userId),
    minutesBetween(userId, start, end),
    db
      .select({ s: planSession })
      .from(planSession)
      // Only sessions for a library item can be the spotlight, so a free-text one ("Board games") must not hide the next one that is.
      .where(and(eq(planSession.userId, userId), eq(planSession.done, false), isNotNull(planSession.itemId), gte(planSession.startsAt, new Date(now.getTime() - 30 * 60_000))))
      .orderBy(asc(planSession.startsAt))
      .limit(1),
  ]);

  const pool = category ? all.filter((c) => c.category === category) : all;
  const inProgress = pool.filter((c) => c.status === "in_progress").sort(byRecent);

  let chosen: Candidate | undefined;
  let plannedAt: Date | null = null;
  const session = next[0]?.s;
  if (session?.itemId && session.startsAt.getTime() - now.getTime() < 48 * 3600_000) {
    chosen = pool.find((c) => c.itemId === session.itemId);
    if (chosen) plannedAt = session.startsAt;
  }
  chosen ??= inProgress[0];
  chosen ??= pool.filter((c) => c.status === "want" && c.priority === "must")[0] ?? pool.find((c) => c.status === "want") ?? pool[0];

  const spotlight: Spotlight | null = chosen
    ? {
        entryId: chosen.entryId,
        title: chosen.title,
        category: chosen.category,
        coverUrl: chosen.coverUrl,
        kicker: plannedAt ? `Up next · ${relativeDay(plannedAt, now, zone)} ${timeLabel(plannedAt, zone)}` : chosen.status === "in_progress" ? "Pick up where you left off" : "Up next",
        line: nextUpText(chosen),
        status: chosen.status,
        unit: chosen.unit,
        plannedAt,
      }
    : null;

  const more = inProgress.filter((c) => c.entryId !== chosen?.entryId).slice(0, 10);
  return { goalMinutes, spentMinutes: spent, spotlight, more, total: all.length };
}

export async function recentlyDone(userId: string, limit = 5) {
  return db
    .select({ e: entry, i: item })
    .from(entry)
    .innerJoin(item, eq(entry.itemId, item.id))
    .where(and(eq(entry.userId, userId), eq(entry.status, "done")))
    .orderBy(desc(entry.finishedAt))
    .limit(limit);
}
