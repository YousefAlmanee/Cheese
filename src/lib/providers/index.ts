import type { Category, Source } from "@/db/schema";
import { anilist } from "./anilist";
import { books } from "./books";
import { igdb } from "./igdb";
import { tmdb } from "./tmdb";
import { ProviderError, type ItemDraft, type Provider, type Ref } from "./types";

export type { ItemDraft, Ref } from "./types";

const providers: Provider[] = [tmdb, anilist, books, igdb];
const TIMEOUT_MS = 6000;

export type SearchOutcome = {
  hits: ItemDraft[];
  /** Providers that were configured but failed this time (network error, rate limit). */
  failed: { provider: string; categories: Category[] }[];
  /** Categories that cannot be searched because the server has no API key for them. */
  unavailable: Category[];
};

function norm(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Exact title matches first, then titles that start with the query, then the rest. Stable within each group. */
export function rank(hits: ItemDraft[], query: string): ItemDraft[] {
  const q = norm(query);
  const score = (h: ItemDraft) => {
    const t = norm(h.title);
    return t === q ? 0 : t.startsWith(q) ? 1 : t.includes(q) ? 2 : 3;
  };
  return hits.map((h, i) => ({ h, i, s: score(h) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.h);
}

/** Round-robin across providers so one source cannot fill the whole list. */
function interleave(lists: ItemDraft[][]): ItemDraft[] {
  const out: ItemDraft[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

export async function searchAll(query: string, only?: Category): Promise<SearchOutcome> {
  const q = query.trim();
  const wanted = providers.filter((p) => !only || p.categories.includes(only));
  const unavailable = wanted.filter((p) => !p.enabled()).flatMap((p) => p.categories.filter((c) => !only || c === only));
  const active = wanted.filter((p) => p.enabled());
  if (q.length < 2) return { hits: [], failed: [], unavailable };

  const settled = await Promise.allSettled(active.map((p) => p.search(q, AbortSignal.timeout(TIMEOUT_MS))));
  const lists: ItemDraft[][] = [];
  const failed: SearchOutcome["failed"] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") lists.push(r.value.filter((h) => !only || h.category === only));
    else failed.push({ provider: active[i].source, categories: active[i].categories });
  });
  return { hits: rank(interleave(lists), q), failed, unavailable };
}

// Popular titles change slowly, so cache each source's list in memory and reuse it across requests.
const POPULAR_TTL_MS = 6 * 60 * 60 * 1000;
const popularCache = new Map<string, { at: number; hits: ItemDraft[] }>();

async function popularFor(p: Provider): Promise<ItemDraft[]> {
  const cached = popularCache.get(p.source);
  if (cached && Date.now() - cached.at < POPULAR_TTL_MS) return cached.hits;
  const hits = await p.popular!(AbortSignal.timeout(TIMEOUT_MS));
  popularCache.set(p.source, { at: Date.now(), hits });
  return hits;
}

/** Trending / popular titles for discovery, before anyone types. Shape mirrors {@link searchAll}. */
export async function popularAll(only?: Category): Promise<SearchOutcome> {
  const wanted = providers.filter((p) => !only || p.categories.includes(only));
  const unavailable = wanted.filter((p) => !p.enabled()).flatMap((p) => p.categories.filter((c) => !only || c === only));
  const active = wanted.filter((p) => p.enabled() && typeof p.popular === "function");

  const settled = await Promise.allSettled(active.map((p) => popularFor(p)));
  const lists: ItemDraft[][] = [];
  const failed: SearchOutcome["failed"] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") lists.push(r.value.filter((h) => !only || h.category === only));
    else failed.push({ provider: active[i].source, categories: active[i].categories });
  });
  return { hits: interleave(lists), failed, unavailable };
}

export function providerFor(source: Source, category: Category): Provider | undefined {
  if (source === "openlibrary" || source === "googlebooks") return books;
  return providers.find((p) => p.source === source && p.categories.includes(category));
}

/** Fetches the authoritative record for a reference. Used when someone adds an item. */
export async function fetchDetails(ref: Ref): Promise<ItemDraft> {
  const p = providerFor(ref.source, ref.category);
  if (!p || !p.enabled()) throw new ProviderError(ref.source, "this source is not available");
  const draft = await p.details(ref, AbortSignal.timeout(TIMEOUT_MS * 2));
  if (draft.category !== ref.category) throw new ProviderError(ref.source, "category mismatch");
  return draft;
}
