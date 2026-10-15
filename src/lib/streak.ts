import { sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";

/** A freeze is earned every this many counted weeks in a row. */
export const FREEZE_EVERY = 4;
export const MAX_FREEZES = 2;

export type Streak = {
  /** Counted weeks in a row, including this week once it has activity. */
  current: number;
  longest: number;
  /** Missed weeks the person can still absorb without losing the streak. */
  freezes: number;
  /** Whether this week already counts. */
  activeThisWeek: boolean;
  /** Weeks that were bridged by a freeze, newest last. Shown so a saved streak is not a mystery. */
  frozenWeeks: string[];
};

const nextWeek = (monday: string) => DateTime.fromISO(monday, { zone: "utc" }).plus({ weeks: 1 }).toISODate() as string;

/**
 * Weekly streak with freezes, from history alone.
 * `activeWeeks` are the Mondays (YYYY-MM-DD, local) of weeks with activity; `thisWeek` is the Monday of the week in progress.
 * Weeks before this one: a counted week adds one (and every FREEZE_EVERY-th earns a freeze, up to MAX_FREEZES);
 * a missed week spends a freeze and keeps the streak, or ends it if there is none.
 * The week in progress never breaks the streak. It adds one once it has activity.
 */
export function computeStreak(activeWeeks: string[], thisWeek: string): Streak {
  const active = new Set(activeWeeks);
  const sorted = [...active].filter((w) => w <= thisWeek).sort();
  let current = 0;
  let longest = 0;
  let freezes = 0;
  let frozenWeeks: string[] = [];

  const count = () => {
    current++;
    longest = Math.max(longest, current);
    if (current % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
  };

  if (sorted.length) {
    for (let w = sorted[0]; w < thisWeek; w = nextWeek(w)) {
      if (active.has(w)) count();
      else if (current > 0 && freezes > 0) {
        freezes--;
        frozenWeeks.push(w);
      } else {
        current = 0;
        frozenWeeks = [];
      }
    }
  }
  const activeThisWeek = active.has(thisWeek);
  if (activeThisWeek) count();
  return { current, longest, freezes, activeThisWeek, frozenWeeks: frozenWeeks.slice(-MAX_FREEZES * FREEZE_EVERY) };
}

/** A short line for the person: "3-week streak", "1 freeze saved". */
export function streakLine(s: Streak): string {
  const parts = [`${s.current}-week streak`];
  if (s.freezes > 0) parts.push(`${s.freezes} ${s.freezes === 1 ? "freeze" : "freezes"} saved`);
  return parts.join(" · ");
}

/** Mondays of every local week in which the person logged net time or finished a title. */
export async function activeWeeksFor(userId: string, zone: string): Promise<string[]> {
  const rows = await db.execute<{ week: string }>(sql`
    select week from (
      select date_trunc('week', "at" at time zone ${zone})::date::text as week
      from progress_log where user_id = ${userId}
      group by 1 having sum(minutes) > 0
      union
      select date_trunc('week', finished_at at time zone ${zone})::date::text as week
      from entry where user_id = ${userId} and status = 'done' and finished_at is not null
    ) w order by week`);
  return rows.rows.map((r) => r.week);
}

export async function loadStreak(userId: string, zone: string, now = new Date()): Promise<Streak> {
  const thisWeek = DateTime.fromJSDate(now, { zone }).startOf("week").toISODate() as string;
  return computeStreak(await activeWeeksFor(userId, zone), thisWeek);
}
