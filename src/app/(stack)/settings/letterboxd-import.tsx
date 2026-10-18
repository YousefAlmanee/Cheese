"use client";

import { useState } from "react";
import { importLetterboxd, matchLetterboxd } from "@/app/actions/import";
import { mergeFiles, parseLetterboxdFile, type LetterboxdRow, type ParsedFile } from "@/lib/letterboxd";
import { readCsvFromZip } from "@/lib/zip";

const BATCH = 8;
type Matched = { row: LetterboxdRow; ref: string };

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += BATCH) out.push(list.slice(i, i + BATCH));
  return out;
}

export function LetterboxdImport() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Matched[] | null>(null);
  const [missing, setMissing] = useState<LetterboxdRow[]>([]);
  const [result, setResult] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    setError(null);
    setResult(null);
    setFound(null);
    if (!files || files.length === 0) return;
    try {
      const parsed: ParsedFile[] = [];
      for (const f of Array.from(files)) {
        const texts = f.name.toLowerCase().endsWith(".zip") ? await readCsvFromZip(await f.arrayBuffer()) : { [f.name]: await f.text() };
        for (const [name, text] of Object.entries(texts)) {
          const base = name.split("/").pop() ?? name;
          if (base.toLowerCase() === "diary.csv" || base.toLowerCase() === "reviews.csv") continue;
          const p = parseLetterboxdFile(base, text);
          if (p) parsed.push(p);
        }
      }
      const rows = mergeFiles(parsed);
      if (rows.length === 0) return setError("No films found. Choose the zip from Letterboxd, or its watched.csv, ratings.csv or watchlist.csv.");

      const ok: Matched[] = [];
      const lost: LetterboxdRow[] = [];
      let done = 0;
      for (const batch of chunks(rows)) {
        setBusy(`Looking up films ${done} of ${rows.length}`);
        const res = await matchLetterboxd(batch);
        if (!res.ok) return setError(res.error);
        for (const m of res.matches) (m.ref ? ok.push({ row: m.row, ref: m.ref }) : lost.push(m.row));
        done += batch.length;
      }
      setFound(ok);
      setMissing(lost);
    } catch {
      setError("That file could not be read. Try the zip straight from Letterboxd.");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!found) return;
    setError(null);
    const total = { added: 0, updated: 0, skipped: 0, failed: 0 };
    try {
      let done = 0;
      for (const batch of chunks(found)) {
        setBusy(`Adding films ${done} of ${found.length}`);
        const res = await importLetterboxd(batch);
        if (!res.ok) return setError(res.error);
        total.added += res.added;
        total.updated += res.updated;
        total.skipped += res.skipped;
        total.failed += res.failed;
        done += batch.length;
      }
      setFound(null);
      setResult(
        `Added ${total.added}, updated ${total.updated}, already there ${total.skipped}` + (total.failed ? `, ${total.failed} could not be added (run it again to retry)` : "") + ".",
      );
    } catch {
      setError("Something went wrong part way. Films already added stay; run it again to finish.");
    } finally {
      setBusy(null);
    }
  }

  const watched = found?.filter((m) => !m.row.watchlist).length ?? 0;
  const planned = (found?.length ?? 0) - watched;

  return (
    <div className="stack">
      <p className="hint">
        On Letterboxd, go to Settings, Data, and export your data. Choose that zip here (or watched.csv, ratings.csv and watchlist.csv). Watched films come in as finished with
        their date and rating; the watchlist comes in as "Want to". Nothing is added until you confirm.
      </p>
      <input type="file" accept=".zip,.csv,text/csv" multiple disabled={busy !== null} onChange={(e) => onFiles(e.target.files)} aria-label="Letterboxd export" />
      {busy && <p className="hint" role="status">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <p className="hint" role="status">{result}</p>}
      {found && (
        <>
          <p role="status">
            Found {watched} watched and {planned} to watch.
            {missing.length > 0 && ` ${missing.length} could not be matched and will be skipped.`}
          </p>
          {missing.length > 0 && (
            <details>
              <summary>Not matched</summary>
              <ul>
                {missing.slice(0, 100).map((r, i) => (
                  <li key={i}>
                    {r.name}
                    {r.year ? ` (${r.year})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button className="ch-btn ch-btn--primary ch-btn--block" onClick={run} disabled={busy !== null || found.length === 0}>
            Add {found.length} films
          </button>
        </>
      )}
    </div>
  );
}
