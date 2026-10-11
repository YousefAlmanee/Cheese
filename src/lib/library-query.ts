import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { CATEGORIES, entry, item, PRIORITIES, STATUSES, type Category, type Status } from "@/db/schema";
import { totalMinutes } from "./length";

export const SORTS = ["recent", "priority", "shortest", "longest"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABEL: Record<Sort, string> = {
  recent: "Recently updated",
  priority: "Must do first",
  shortest: "Shortest first",
  longest: "Longest first",
};

export type LibraryFilter = {
  status?: Status;
  category?: Category;
  sort: Sort;
  mustOnly: boolean;
  genre?: string;
  q?: string;
};

/** Reads a filter out of URL search params, ignoring anything that is not a known value. */
export function parseFilter(sp: Record<string, string | string[] | undefined>): LibraryFilter {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const status = one("status");
  const category = one("category");
  const sort = one("sort");
  return {
    status: STATUSES.includes(status as Status) ? (status as Status) : undefined,
    category: CATEGORIES.includes(category as Category) ? (category as Category) : undefined,
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : "recent",
    mustOnly: one("priority") === "must",
    genre: one("genre")?.slice(0, 40) || undefined,
    q: one("q")?.trim().slice(0, 80) || undefined,
  };
}

/** How many items the Library shows at first, and how many more each "Show more" adds. */
export const PAGE_SIZE = 60;

export type LibraryRow = { entry: typeof entry.$inferSelect; item: typeof item.$inferSelect };

export async function listLibrary(userId: string, f: LibraryFilter, limit = PAGE_SIZE): Promise<{ rows: LibraryRow[]; total: number }> {
  const where = and(
    eq(entry.userId, userId),
    f.status ? eq(entry.status, f.status) : undefined,
    f.category ? eq(item.category, f.category) : undefined,
    f.mustOnly ? eq(entry.priority, PRIORITIES[0]) : undefined,
    f.genre ? sql`${f.genre} = any(${item.genres})` : undefined,
    f.q ? ilike(item.title, `%${f.q.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
  );
  const rows = await db.select({ entry, item }).from(entry).innerJoin(item, eq(entry.itemId, item.id)).where(where).orderBy(desc(entry.updatedAt));
  const len = (r: LibraryRow) => totalMinutes(r.item, r.entry.totalOverride) ?? Number.MAX_SAFE_INTEGER;
  // Length is worked out in code, so the order is applied here and the page is cut afterwards.
  if (f.status === "done" && f.sort === "recent") {
    rows.sort((a, b) => (b.entry.finishedAt?.getTime() ?? 0) - (a.entry.finishedAt?.getTime() ?? 0));
  } else if (f.sort === "priority") {
    rows.sort((a, b) => Number(b.entry.priority === "must") - Number(a.entry.priority === "must"));
  } else if (f.sort === "shortest") {
    rows.sort((a, b) => len(a) - len(b));
  } else if (f.sort === "longest") {
    rows.sort((a, b) => (len(b) === Number.MAX_SAFE_INTEGER ? -1 : len(a) === Number.MAX_SAFE_INTEGER ? 1 : len(b) - len(a)));
  }
  return { rows: rows.slice(0, Math.max(1, limit)), total: rows.length };
}

/** Genres present in this person's library, most common first. Used for the genre filter. */
export async function libraryGenres(userId: string, limit = 8): Promise<string[]> {
  const res = await db.execute<{ genre: string; n: number }>(sql`
    select g as genre, count(*)::int as n
    from ${entry} e join ${item} i on i.id = e.item_id, unnest(i.genres) g
    where e.user_id = ${userId}
    group by g order by n desc, g asc limit ${limit}`);
  return res.rows.map((r) => r.genre);
}

export async function statusCounts(userId: string): Promise<Record<Status | "all", number>> {
  const res = await db.execute<{ status: Status; n: number }>(sql`
    select status, count(*)::int as n from ${entry} where user_id = ${userId} group by status`);
  const out: Record<string, number> = { all: 0, want: 0, in_progress: 0, paused: 0, done: 0, dropped: 0 };
  for (const r of res.rows) {
    out[r.status] = r.n;
    out.all += r.n;
  }
  return out as Record<Status | "all", number>;
}
