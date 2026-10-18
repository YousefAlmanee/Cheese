"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BATCH, importRows, matchRows } from "@/lib/letterboxd-import";
import { requireUser } from "@/lib/session";

const rowSchema = z.object({
  name: z.string().trim().min(1).max(300),
  year: z.number().int().min(1800).max(2200).nullable(),
  watched: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  ratingHalf: z.number().int().min(1).max(10).nullable(),
  watchlist: z.boolean(),
});

const matchSchema = z.array(rowSchema).max(BATCH);
const importSchema = z.array(z.object({ row: rowSchema, ref: z.string().regex(/^movie\/\d+$/) })).max(BATCH);

export type MatchBatch = { ok: true; matches: { row: z.infer<typeof rowSchema>; ref: string | null; failed?: boolean }[] } | { ok: false; error: string };
export type ImportBatch = { ok: true; added: number; updated: number; skipped: number; failed: number } | { ok: false; error: string };

export async function matchLetterboxd(input: unknown): Promise<MatchBatch> {
  await requireUser();
  const rows = matchSchema.safeParse(input);
  if (!rows.success) return { ok: false, error: "Those rows could not be read." };
  if (!process.env.TMDB_API_KEY) return { ok: false, error: "Movie lookup is not set up on this server." };
  return { ok: true, matches: await matchRows(rows.data) };
}

export async function importLetterboxd(input: unknown): Promise<ImportBatch> {
  const { user } = await requireUser();
  const matches = importSchema.safeParse(input);
  if (!matches.success) return { ok: false, error: "Those rows could not be read." };
  const result = await importRows(user.id, matches.data);
  revalidatePath("/library");
  revalidatePath("/");
  return { ok: true, ...result };
}
