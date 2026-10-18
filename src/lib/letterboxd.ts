// Reads the CSV files from a Letterboxd data export. Pure, so the settings page can parse in the browser.

export type LetterboxdRow = {
  name: string;
  year: number | null;
  /** Day the film was watched (YYYY-MM-DD), from watched.csv or ratings.csv. */
  watched: string | null;
  /** Rating in half stars (1 to 10), from ratings.csv. */
  ratingHalf: number | null;
  /** On the watchlist and not watched. */
  watchlist: boolean;
};

/** Splits CSV text into rows of cells. Handles quoted cells, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') (cell += '"'), i++;
        else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

export type LetterboxdKind = "watched" | "ratings" | "watchlist";

/** Which Letterboxd file this is, judged by its columns, or null when it is not one we use. */
export function detectKind(header: string[]): LetterboxdKind | null {
  const h = header.map((x) => x.trim().toLowerCase());
  if (!h.includes("name") || !h.includes("year")) return null;
  if (h.includes("rating")) return "ratings";
  return h.includes("letterboxd uri") || h.includes("date") ? "watched" : null;
}

const isDay = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null);

export type ParsedFile = { kind: LetterboxdKind; rows: LetterboxdRow[] };

/** Parses one file. `fileName` tells watched.csv and watchlist.csv apart, since their columns are the same. */
export function parseLetterboxdFile(fileName: string, text: string): ParsedFile | null {
  const table = parseCsv(text);
  if (table.length === 0) return null;
  const header = table[0].map((x) => x.trim().toLowerCase());
  const base = detectKind(table[0]);
  if (!base) return null;
  const lower = fileName.toLowerCase();
  const kind: LetterboxdKind = base === "ratings" ? "ratings" : lower.includes("watchlist") ? "watchlist" : "watched";
  const col = (n: string) => header.indexOf(n);
  const iName = col("name"), iYear = col("year"), iDate = col("date"), iRating = col("rating");
  const rows: LetterboxdRow[] = [];
  for (const r of table.slice(1)) {
    const name = (r[iName] ?? "").trim();
    if (!name) continue;
    const y = Number((r[iYear] ?? "").trim());
    const stars = iRating >= 0 ? Number((r[iRating] ?? "").trim()) : NaN;
    rows.push({
      name,
      year: Number.isInteger(y) && y > 1800 && y < 2200 ? y : null,
      watched: kind === "watchlist" ? null : isDay(r[iDate]),
      ratingHalf: kind === "ratings" && stars >= 0.5 && stars <= 5 ? Math.round(stars * 2) : null,
      watchlist: kind === "watchlist",
    });
  }
  return { kind, rows };
}

const keyOf = (r: { name: string; year: number | null }) => `${r.name.toLowerCase()}|${r.year ?? ""}`;

/**
 * Combines the files into one row per film. A rated film counts as watched. Watched beats watchlist.
 * When a film appears more than once (a rewatch), the latest watched date is kept.
 */
export function mergeFiles(files: ParsedFile[]): LetterboxdRow[] {
  const byKey = new Map<string, LetterboxdRow & { seenWatched: boolean }>();
  for (const f of files) {
    for (const r of f.rows) {
      const k = keyOf(r);
      const cur = byKey.get(k) ?? { name: r.name, year: r.year, watched: null, ratingHalf: null, watchlist: false, seenWatched: false };
      if (f.kind === "watchlist") cur.watchlist = true;
      else {
        cur.seenWatched = true;
        if (r.watched && (!cur.watched || r.watched > cur.watched)) cur.watched = r.watched;
        if (r.ratingHalf != null) cur.ratingHalf = r.ratingHalf;
      }
      byKey.set(k, cur);
    }
  }
  return [...byKey.values()].map(({ seenWatched, ...r }) => ({ ...r, watchlist: r.watchlist && !seenWatched }));
}
