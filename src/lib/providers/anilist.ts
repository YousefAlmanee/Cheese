import { fetchJson, clip } from "./http";
import { ProviderError, type ItemDraft, type Provider, type Ref } from "./types";

const URL = "https://graphql.anilist.co";

const FIELDS = `
  id type format
  title { romaji english }
  startDate { year }
  coverImage { large }
  episodes duration chapters
  genres
  description(asHtml: false)
  studios(isMain: true) { nodes { name } }
  staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
`;

const SEARCH = `query ($q: String) { Page(perPage: 8) { media(search: $q, sort: SEARCH_MATCH) { ${FIELDS} } } }`;
const BY_ID = `query ($id: Int) { Media(id: $id) { ${FIELDS} } }`;
const POPULAR = `query {
  anime: Page(perPage: 8) { media(sort: TRENDING_DESC, type: ANIME, isAdult: false, genre_not_in: ["Ecchi", "Hentai"]) { ${FIELDS} } }
  manga: Page(perPage: 4) { media(sort: TRENDING_DESC, type: MANGA, isAdult: false, genre_not_in: ["Ecchi", "Hentai"]) { ${FIELDS} } }
}`;

type Media = {
  id: number;
  type: "ANIME" | "MANGA";
  format?: string | null;
  title: { romaji?: string | null; english?: string | null };
  startDate?: { year?: number | null };
  coverImage?: { large?: string | null };
  episodes?: number | null;
  duration?: number | null;
  chapters?: number | null;
  genres?: string[];
  description?: string | null;
  studios?: { nodes?: { name: string }[] };
  staff?: { edges?: { role?: string; node: { name: { full: string } } }[] };
};

export function mediaDraft(m: Media): ItemDraft {
  const title = m.title.english || m.title.romaji || "Untitled";
  const common = {
    source: "anilist" as const,
    externalId: String(m.id),
    title,
    year: m.startDate?.year ?? null,
    coverUrl: m.coverImage?.large ?? null,
    summary: clip(m.description),
    genres: m.genres ?? [],
    platforms: [],
  };
  if (m.type === "ANIME") {
    return {
      ...common,
      category: "anime",
      creator: m.studios?.nodes?.[0]?.name ?? null,
      unit: "episode",
      totalUnits: m.format === "MOVIE" ? 1 : (m.episodes ?? null),
      unitSeconds: m.duration ? m.duration * 60 : null,
    };
  }
  const author = m.staff?.edges?.find((e) => /story/i.test(e.role ?? "")) ?? m.staff?.edges?.[0];
  return {
    ...common,
    category: "manga",
    creator: author?.node.name.full ?? null,
    unit: "chapter",
    totalUnits: m.chapters ?? null,
    unitSeconds: null,
  };
}

async function gql<T>(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const res = await fetchJson<{ data?: T; errors?: { message: string }[] }>(
    "AniList",
    URL,
    { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }) },
    signal,
  );
  if (res.errors?.length || !res.data) throw new ProviderError("AniList", res.errors?.[0]?.message ?? "empty response");
  return res.data;
}

export const anilist: Provider = {
  source: "anilist",
  categories: ["anime", "manga"],
  enabled: () => true,

  async search(query, signal) {
    const data = await gql<{ Page: { media: Media[] } }>(SEARCH, { q: query }, signal);
    return data.Page.media.map(mediaDraft);
  },

  async popular(signal) {
    const data = await gql<{ anime: { media: Media[] }; manga: { media: Media[] } }>(POPULAR, {}, signal);
    // Ecchi and hentai stay searchable but never get suggested.
    return [...data.anime.media, ...data.manga.media].filter((m) => !m.genres?.some((g) => /^(ecchi|hentai)$/i.test(g))).map(mediaDraft);
  },

  async details(ref: Ref, signal) {
    const id = Number(ref.externalId);
    if (!Number.isInteger(id)) throw new ProviderError("AniList", `bad id ${ref.externalId}`);
    const data = await gql<{ Media: Media }>(BY_ID, { id }, signal);
    return mediaDraft(data.Media);
  },
};
