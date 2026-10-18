import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { changeStatus } from "./entries";
import { addEntry, upsertItem } from "./library";
import type { LetterboxdRow } from "./letterboxd";
import { fetchDetails } from "./providers";
import { findMovie } from "./providers/tmdb";

const TIMEOUT_MS = 8000;
/** Films handled per request, so one request stays well inside the time limit. */
export const BATCH = 8;

export type Match = { row: LetterboxdRow; ref: string | null; failed?: boolean };

/** Looks each film up on TMDB. A film that is not found has `ref: null`; one that could not be checked has `failed`. */
export async function matchRows(rows: LetterboxdRow[]): Promise<Match[]> {
  return Promise.all(
    rows.slice(0, BATCH).map(async (row): Promise<Match> => {
      try {
        return { row, ref: await findMovie(row.name, row.year, AbortSignal.timeout(TIMEOUT_MS)) };
      } catch {
        return { row, ref: null, failed: true };
      }
    }),
  );
}

export type ImportOutcome = "added" | "updated" | "skipped" | "failed";

/**
 * Adds one matched film. Watched films become finished (with the date and rating from Letterboxd); watchlist films
 * become "want to". Nothing already in the library is made worse: a finished title stays finished with its own
 * date, a rating is only filled in when there is none, and a watchlist row never changes an existing entry.
 */
export async function importOne(userId: string, match: { row: LetterboxdRow; ref: string }): Promise<ImportOutcome> {
  try {
    const draft = await fetchDetails({ source: "tmdb", externalId: match.ref, category: "movie" });
    const item = await upsertItem(draft);
    const { entry: e, created } = await addEntry(userId, item.id);
    const { row } = match;
    if (row.watchlist) return created ? "added" : "skipped";

    let result = await changeStatus(userId, e.id, "done");
    if (!result) return "failed";
    const patch: Partial<typeof entry.$inferInsert> = {};
    if (row.watched && (created || e.status !== "done")) {
      const day = new Date(`${row.watched}T12:00:00Z`);
      patch.finishedAt = day;
      if (created) patch.startedAt = day;
    }
    if (row.ratingHalf != null && e.ratingHalf == null) patch.ratingHalf = row.ratingHalf;
    if (Object.keys(patch).length) {
      await db.update(entry).set({ ...patch, updatedAt: new Date() }).where(and(eq(entry.id, e.id), eq(entry.userId, userId)));
    }
    return created ? "added" : e.status !== "done" || patch.ratingHalf != null ? "updated" : "skipped";
  } catch {
    return "failed";
  }
}

export async function importRows(userId: string, matches: { row: LetterboxdRow; ref: string }[]) {
  const outcomes = await Promise.all(matches.slice(0, BATCH).map((m) => importOne(userId, m)));
  const count = (o: ImportOutcome) => outcomes.filter((x) => x === o).length;
  return { added: count("added"), updated: count("updated"), skipped: count("skipped"), failed: count("failed") };
}
