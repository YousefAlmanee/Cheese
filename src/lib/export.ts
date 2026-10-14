import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { entry, freeOverride, freeWindow, item, planSession, profile, progressLog } from "@/db/schema";

/**
 * Everything a person owns, as plain data. Hidden entries are included, since it is their own list.
 * Left out on purpose: calendar token, invite code, push devices, and anything about other people.
 */
export async function exportAll(userId: string, now = new Date()) {
  const [p] = await db.select().from(profile).where(eq(profile.userId, userId));
  if (!p) return null;
  const [entries, log, sessions, windows, overrides] = await Promise.all([
    db.select({ e: entry, i: item }).from(entry).innerJoin(item, eq(entry.itemId, item.id)).where(eq(entry.userId, userId)).orderBy(asc(entry.createdAt)),
    db.select().from(progressLog).where(eq(progressLog.userId, userId)).orderBy(asc(progressLog.at)),
    db.select().from(planSession).where(eq(planSession.userId, userId)).orderBy(asc(planSession.startsAt)),
    db.select().from(freeWindow).where(eq(freeWindow.userId, userId)).orderBy(asc(freeWindow.weekday), asc(freeWindow.startMin)),
    db.select().from(freeOverride).where(eq(freeOverride.userId, userId)).orderBy(asc(freeOverride.day), asc(freeOverride.startMin)),
  ]);
  return {
    app: "Cheese",
    exportedAt: now.toISOString(),
    profile: {
      username: p.username,
      displayName: p.displayName,
      timezone: p.timezone,
      weeklyGoalMinutes: p.weeklyGoalMinutes,
      createdAt: p.createdAt,
    },
    library: entries.map(({ e, i }) => ({
      title: i.title,
      category: i.category,
      creator: i.creator,
      year: i.year,
      source: i.source,
      externalId: i.externalId,
      status: e.status,
      priority: e.priority,
      progress: e.progress,
      unit: i.unit,
      totalUnits: e.totalOverride ?? i.totalUnits,
      rating: e.ratingHalf == null ? null : e.ratingHalf / 2,
      review: e.review,
      platform: e.platform,
      together: e.together,
      hidden: e.hidden,
      wouldRedo: e.wouldRedo,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      addedAt: e.createdAt,
    })),
    timeLog: log.map((l) => ({ at: l.at, units: l.deltaUnits, minutes: l.minutes })),
    plannedSessions: sessions.map((s) => ({ title: s.title, startsAt: s.startsAt, durationMin: s.durationMin, units: s.units, done: s.done, note: s.note })),
    freeTime: {
      weekly: windows.map((w) => ({ weekday: w.weekday, startMin: w.startMin, endMin: w.endMin })),
      overrides: overrides.map((o) => ({ day: o.day, kind: o.kind, startMin: o.startMin, endMin: o.endMin })),
    },
  };
}

export type Export = NonNullable<Awaited<ReturnType<typeof exportAll>>>;

/** One cell of a CSV file. Quotes anything with a comma, quote or line break, and defuses spreadsheet formulas. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // A cell that starts with these is run as a formula by Excel and Sheets, so it gets a leading apostrophe.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function libraryCsv(data: Export): string {
  const cols = ["title", "category", "creator", "year", "status", "progress", "unit", "totalUnits", "rating", "review", "platform", "priority", "hidden", "startedAt", "finishedAt", "addedAt"] as const;
  const lines = [cols.join(",")];
  for (const row of data.library) lines.push(cols.map((c) => csvCell(row[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
