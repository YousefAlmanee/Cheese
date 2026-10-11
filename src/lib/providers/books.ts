import { fetchJson, clip, yearOf } from "./http";
import { ProviderError, type ItemDraft, type Provider, type Ref } from "./types";

const OL = "https://openlibrary.org";
const GB = "https://www.googleapis.com/books/v1/volumes";

/* ---------- Open Library ---------- */

type OlDoc = {
  key: string; // "/works/OL45804W"
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  number_of_pages_median?: number;
  subject?: string[];
};

function olCover(id?: number | null): string | null {
  return id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : null;
}

function olDraft(d: OlDoc): ItemDraft {
  return {
    category: "book",
    source: "openlibrary",
    externalId: d.key.replace("/works/", ""),
    title: d.title,
    creator: d.author_name?.[0] ?? null,
    year: d.first_publish_year ?? null,
    coverUrl: olCover(d.cover_i),
    summary: null,
    unit: "page",
    totalUnits: d.number_of_pages_median ?? null,
    unitSeconds: null,
    genres: (d.subject ?? []).slice(0, 4),
    platforms: [],
  };
}

type OlWork = {
  title: string;
  description?: string | { value: string };
  covers?: number[];
  subjects?: string[];
  first_publish_date?: string;
  authors?: { author?: { key: string } }[];
};

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const openlibrary: Provider = {
  source: "openlibrary",
  categories: ["book"],
  enabled: () => true,

  async search(query, signal) {
    const fields = "key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject";
    const url = `${OL}/search.json?q=${encodeURIComponent(query)}&limit=8&fields=${fields}`;
    const data = await fetchJson<{ docs?: OlDoc[] }>("Open Library", url, {}, signal);
    return (data.docs ?? []).filter((d) => d.key?.startsWith("/works/")).map(olDraft);
  },

  async details(ref: Ref, signal) {
    if (!/^OL\d+W$/.test(ref.externalId)) throw new ProviderError("Open Library", `bad id ${ref.externalId}`);
    const work = await fetchJson<OlWork>("Open Library", `${OL}/works/${ref.externalId}.json`, {}, signal);
    const authorKeys = (work.authors ?? []).map((a) => a.author?.key).filter((k): k is string => Boolean(k));
    const [editions, authorNames] = await Promise.all([
      fetchJson<{ entries?: { number_of_pages?: number }[] }>(
        "Open Library",
        `${OL}/works/${ref.externalId}/editions.json?limit=30`,
        {},
        signal,
      ).catch(() => ({ entries: [] })),
      Promise.all(
        authorKeys.slice(0, 2).map((k) =>
          fetchJson<{ name?: string }>("Open Library", `${OL}${k}.json`, {}, signal)
            .then((a) => a.name ?? null)
            .catch(() => null),
        ),
      ),
    ]);
    const pages = median((editions.entries ?? []).map((e) => e.number_of_pages ?? 0).filter((n) => n >= 20 && n <= 3000));
    const desc = typeof work.description === "string" ? work.description : work.description?.value;
    return {
      category: "book",
      source: "openlibrary",
      externalId: ref.externalId,
      title: work.title,
      creator: authorNames.filter(Boolean).join(", ") || null,
      year: yearOf(work.first_publish_date) ?? (work.first_publish_date?.match(/\d{4}/)?.[0] ? Number(work.first_publish_date.match(/\d{4}/)![0]) : null),
      coverUrl: olCover(work.covers?.find((c) => c > 0)),
      summary: clip(desc),
      unit: "page",
      totalUnits: pages,
      unitSeconds: null,
      genres: (work.subjects ?? []).slice(0, 4),
      platforms: [],
    };
  },
};

/* ---------- Google Books ---------- */

type GbVolume = {
  id: string;
  volumeInfo: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    pageCount?: number;
    description?: string;
    categories?: string[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
};

function gbDraft(v: GbVolume): ItemDraft | null {
  const i = v.volumeInfo;
  if (!i.title) return null;
  const cover = i.imageLinks?.thumbnail ?? i.imageLinks?.smallThumbnail ?? null;
  return {
    category: "book",
    source: "googlebooks",
    externalId: v.id,
    title: i.title,
    creator: i.authors?.[0] ?? null,
    year: yearOf(i.publishedDate),
    coverUrl: cover ? cover.replace(/^http:/, "https:") : null,
    summary: clip(i.description),
    unit: "page",
    totalUnits: i.pageCount && i.pageCount > 0 ? i.pageCount : null,
    unitSeconds: null,
    genres: (i.categories ?? []).slice(0, 4),
    platforms: [],
  };
}

function gbUrl(path: string, extra = ""): string {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  return `${path}${extra}${key ? `${extra || path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}` : ""}`;
}

const googlebooks: Provider = {
  source: "googlebooks",
  categories: ["book"],
  enabled: () => true,

  async search(query, signal) {
    const url = gbUrl(`${GB}?q=${encodeURIComponent(query)}&maxResults=8&printType=books`);
    const data = await fetchJson<{ items?: GbVolume[] }>("Google Books", url, {}, signal);
    return (data.items ?? []).map(gbDraft).filter((d): d is ItemDraft => d !== null);
  },

  async details(ref: Ref, signal) {
    if (!/^[\w-]{6,20}$/.test(ref.externalId)) throw new ProviderError("Google Books", `bad id ${ref.externalId}`);
    const v = await fetchJson<GbVolume>("Google Books", gbUrl(`${GB}/${ref.externalId}`), {}, signal);
    const d = gbDraft(v);
    if (!d) throw new ProviderError("Google Books", "volume has no title");
    return d;
  },
};

/* ---------- Combined search: both sources, one list ---------- */

function key(d: ItemDraft): string {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  return `${norm(d.title)}|${norm((d.creator ?? "").split(" ").slice(-1)[0])}`;
}

/** Merges Open Library and Google Books hits for the same book. Open Library wins; Google fills a missing cover or page count. */
export function mergeBookHits(ol: ItemDraft[], gb: ItemDraft[]): ItemDraft[] {
  const gbByKey = new Map(gb.map((d) => [key(d), d]));
  const used = new Set<string>();
  const merged = ol.map((d) => {
    const g = gbByKey.get(key(d));
    if (!g) return d;
    used.add(key(d));
    return { ...d, coverUrl: d.coverUrl ?? g.coverUrl, totalUnits: d.totalUnits ?? g.totalUnits, summary: d.summary ?? g.summary };
  });
  for (const g of gb) if (!used.has(key(g))) merged.push(g);
  return merged;
}

export const books: Provider = {
  source: "openlibrary",
  categories: ["book"],
  enabled: () => true,

  async search(query, signal) {
    const [ol, gb] = await Promise.allSettled([openlibrary.search(query, signal), googlebooks.search(query, signal)]);
    if (ol.status === "rejected" && gb.status === "rejected") throw ol.reason;
    return mergeBookHits(ol.status === "fulfilled" ? ol.value : [], gb.status === "fulfilled" ? gb.value : []);
  },

  async popular(signal) {
    const fields = "key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject";
    const data = await fetchJson<{ works?: OlDoc[] }>("Open Library", `${OL}/trending/weekly.json?limit=14&fields=${fields}`, {}, signal);
    return (data.works ?? []).filter((d) => d.key?.startsWith("/works/") && d.cover_i).map(olDraft);
  },

  async details(ref, signal) {
    return ref.source === "googlebooks" ? googlebooks.details(ref, signal) : openlibrary.details(ref, signal);
  },
};
