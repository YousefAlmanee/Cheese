import { fetchJson, clip } from "./http";
import { ProviderError, type ItemDraft, type Provider, type Ref } from "./types";

const API = "https://api.igdb.com/v4";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

let cached: { token: string; expiresAt: number } | null = null;

async function token(signal: AbortSignal): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const id = process.env.TWITCH_CLIENT_ID ?? "";
  const secret = process.env.TWITCH_CLIENT_SECRET ?? "";
  const url = `${TOKEN_URL}?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`;
  const res = await fetchJson<{ access_token: string; expires_in: number }>("IGDB", url, { method: "POST" }, signal, { cacheMs: 0 });
  cached = { token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
  return cached.token;
}

/** Test hook: forget the cached token. */
export function resetIgdbToken() {
  cached = null;
}

async function query<T>(endpoint: string, body: string, signal: AbortSignal): Promise<T> {
  const t = await token(signal);
  return fetchJson<T>(
    "IGDB",
    `${API}/${endpoint}`,
    { method: "POST", headers: { "Client-ID": process.env.TWITCH_CLIENT_ID ?? "", Authorization: `Bearer ${t}`, Accept: "application/json" }, body },
    signal,
  );
}

type Game = {
  id: number;
  name: string;
  first_release_date?: number;
  cover?: { image_id?: string };
  summary?: string;
  genres?: { name: string }[];
  platforms?: { name: string }[];
  involved_companies?: { developer?: boolean; company?: { name: string } }[];
};

const FIELDS =
  "fields name,first_release_date,cover.image_id,summary,genres.name,platforms.name,involved_companies.developer,involved_companies.company.name;";

function gameDraft(g: Game, normallySeconds: number | null): ItemDraft {
  const dev = g.involved_companies?.find((c) => c.developer)?.company?.name ?? g.involved_companies?.[0]?.company?.name ?? null;
  return {
    category: "game",
    source: "igdb",
    externalId: String(g.id),
    title: g.name,
    creator: dev,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    coverUrl: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : null,
    summary: clip(g.summary),
    // Games are counted in minutes played; the total is the usual time to finish the main story.
    unit: "minute",
    totalUnits: normallySeconds ? Math.round(normallySeconds / 60) : null,
    unitSeconds: 60,
    genres: (g.genres ?? []).map((x) => x.name),
    platforms: (g.platforms ?? []).map((x) => x.name),
  };
}

export const igdb: Provider = {
  source: "igdb",
  categories: ["game"],
  enabled: () => Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),

  async search(q, signal) {
    const safe = q.replace(/["\;]/g, " ");
    const games = await query<Game[]>("games", `search "${safe}"; ${FIELDS} where version_parent = null; limit 8;`, signal);
    return games.map((g) => gameDraft(g, null));
  },

  async details(ref: Ref, signal) {
    if (!/^\d+$/.test(ref.externalId)) throw new ProviderError("IGDB", `bad id ${ref.externalId}`);
    const [games, beats] = await Promise.all([
      query<Game[]>("games", `${FIELDS} where id = ${ref.externalId};`, signal),
      query<{ normally?: number; hastily?: number }[]>(
        "game_time_to_beats",
        `fields hastily,normally,completely; where game_id = ${ref.externalId};`,
        signal,
      ).catch(() => []),
    ]);
    if (!games[0]) throw new ProviderError("IGDB", "game not found");
    return gameDraft(games[0], beats[0]?.normally ?? beats[0]?.hastily ?? null);
  },
};
