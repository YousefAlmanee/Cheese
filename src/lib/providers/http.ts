import { ProviderError } from "./types";

const CACHE_MS = 10 * 60_000;
const MAX_ENTRIES = 300;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const cache = new Map<string, { at: number; value: unknown }>();

/** Forgets every cached response. For tests. */
export function resetProviderCache() {
  cache.clear();
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * GETs/POSTs JSON from a provider. A successful answer is remembered for ten minutes, so typing the same search twice
 * (or two people adding the same title) costs one upstream call. A network error, 429 or 5xx is retried once.
 * Pass `cacheMs: 0` for anything that must not be reused, such as a token request.
 */
export async function fetchJson<T>(provider: string, url: string, init: RequestInit, signal: AbortSignal, opts: { cacheMs?: number } = {}): Promise<T> {
  const ttl = opts.cacheMs ?? CACHE_MS;
  const key = `${init.method ?? "GET"} ${url} ${typeof init.body === "string" ? init.body : ""}`;
  if (ttl > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return structuredClone(hit.value) as T;
    if (hit) cache.delete(key);
  }

  let res: Response | undefined;
  let failure = "network error";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, { ...init, signal });
      if (!RETRY_STATUS.has(res.status)) break;
      failure = `HTTP ${res.status}`;
      if (attempt === 0) {
        const wait = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait * 1000, 2000) : 300, signal);
      }
    } catch (e) {
      res = undefined;
      failure = e instanceof Error ? e.message : "network error";
      if (signal.aborted) break;
      if (attempt === 0) await sleep(300, signal);
    }
    if (signal.aborted) break;
  }
  if (!res) throw new ProviderError(provider, failure);
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`);
  let value: T;
  try {
    value = (await res.json()) as T;
  } catch {
    throw new ProviderError(provider, "response was not JSON");
  }
  if (ttl > 0) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string); // oldest first
    cache.set(key, { at: Date.now(), value });
  }
  return structuredClone(value);
}

export function clip(text: string | null | undefined, max = 400): string | null {
  if (!text) return null;
  const t = text.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

export function yearOf(date: string | null | undefined): number | null {
  const m = date?.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}
