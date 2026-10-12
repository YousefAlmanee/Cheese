"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { addToLibrary } from "@/app/actions/library";
import { CategoryTag, StatusBadge } from "@/components/badges";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { discoverHref } from "@/lib/discover";
import { PopularShelves } from "@/components/popular-shelves";
import { CATEGORIES, type Category, type Status } from "@/db/schema";
import { CATEGORY_LABEL, CATEGORY_PLURAL, formatMinutes, totalMinutes } from "@/lib/length";
import type { ItemDraft } from "@/lib/providers/types";

type Response = {
  hits: ItemDraft[];
  failed: { provider: string; categories: Category[] }[];
  unavailable: Category[];
  inLibrary: Record<string, { entryId: string; status: Status }>;
};

const key = (h: { source: string; externalId: string | null }) => `${h.source}:${h.externalId}`;

function meta(h: ItemDraft): string {
  const parts: string[] = [];
  if (h.year) parts.push(String(h.year));
  if (h.creator) parts.push(h.creator);
  const total = totalMinutes(h);
  if (!parts.length && total) parts.push(formatMinutes(total));
  return parts.join(" · ");
}

export function AddSearch() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState<Record<string, { entryId: string; status: Status }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const seq = useRef(0);

  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) {
      setData(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const ctrl = new AbortController();
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}${cat === "all" ? "" : `&category=${cat}`}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Response;
        if (mine === seq.current) {
          setData(json);
          setFailed(false);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError" && mine === seq.current) setFailed(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, cat, term]);

  function add(h: ItemDraft) {
    const k = key(h);
    if (!h.externalId || h.source === "manual") return;
    setPending((p) => new Set(p).add(k));
    setErrors((e) => ({ ...e, [k]: "" }));
    startTransition(async () => {
      const res = await addToLibrary({ source: h.source, externalId: h.externalId, category: h.category });
      setPending((p) => {
        const n = new Set(p);
        n.delete(k);
        return n;
      });
      if (res.ok) setAdded((a) => ({ ...a, [k]: { entryId: res.entryId, status: "want" } }));
      else setErrors((e) => ({ ...e, [k]: res.error }));
    });
  }

  const inLib = { ...(data?.inLibrary ?? {}), ...added };

  return (
    <>
      <section className="stack">
        <label className="ch-search">
          <Icon name="search" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search movies, books, games and more"
            aria-label="Search everything"
            autoFocus
            enterKeyHint="search"
          />
        </label>
      </section>
      <div className="ch-chips" role="group" aria-label="Category">
        {(["all", ...CATEGORIES] as const).map((c) => (
          <button key={c} className="ch-chip ch-chip--quiet" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c === "all" ? "All" : CATEGORY_PLURAL[c]}
          </button>
        ))}
      </div>

      <section className="sec" aria-live="polite">
        {/* Before typing: popular shelves, one row per category, for discovery. */}
        {term.length < 2 && <PopularShelves category={cat === "all" ? undefined : cat} />}

        {loading && <p className="hint">Searching…</p>}
        {failed && <p className="error">Search is not working right now. Check your connection and try again.</p>}

        {data && term.length >= 2 && (
          <>
            {data.hits.length > 0 && <p className="ch-overline">Everything matching</p>}
            <div className="ch-list">
              {data.hits.map((h) => {
                const k = key(h);
                const existing = inLib[k];
                return (
                  <div className="ch-lrow" key={k}>
                    {(() => {
                      // Tapping the cover or title opens the details page without adding the title.
                      const href = existing ? `/item/${existing.entryId}` : discoverHref(h);
                      const text = (
                        <div className="ch-lrow__body">
                          <p className="ch-row-title">{h.title}</p>
                          {meta(h) && <p className="ch-lrow__meta">{meta(h)}</p>}
                          <CategoryTag category={h.category} />
                          {errors[k] && <p className="error">{errors[k]}</p>}
                        </div>
                      );
                      return href ? (
                        <>
                          <Link href={href} tabIndex={-1} aria-hidden="true">
                            <Cover src={h.coverUrl} title={h.title} />
                          </Link>
                          <Link href={href} aria-label={`Details for ${h.title} (${CATEGORY_LABEL[h.category]})`} style={{ color: "inherit", textDecoration: "none", minWidth: 0 }}>
                            {text}
                          </Link>
                        </>
                      ) : (
                        <>
                          <Cover src={h.coverUrl} title={h.title} />
                          {text}
                        </>
                      );
                    })()}
                    {existing ? (
                      <Link href={`/item/${existing.entryId}`} aria-label={`Open ${h.title}`}>
                        <StatusBadge status={existing.status} />
                      </Link>
                    ) : (
                      <button
                        className="ch-btn ch-btn--pill"
                        onClick={() => add(h)}
                        disabled={pending.has(k)}
                        aria-label={`Add ${h.title} (${CATEGORY_LABEL[h.category]})`}
                      >
                        <Icon name="plus" small />
                        {pending.has(k) ? "Adding" : "Add"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {!loading && data.hits.length === 0 && <p className="hint">Nothing found for “{term}”.</p>}
            {data.failed.length > 0 && (
              <p className="hint">
                Could not reach the source for {data.failed.flatMap((f) => f.categories).map((c) => CATEGORY_PLURAL[c]).join(", ")}. Try again in a moment.
              </p>
            )}
            {data.unavailable.length > 0 && (
              <p className="hint">Search is not set up for {data.unavailable.map((c) => CATEGORY_PLURAL[c]).join(", ")} yet.</p>
            )}
          </>
        )}
      </section>

      <section>
        <p className="hint">
          Cannot find it? <Link href="/add/manual">Add it yourself</Link>.
        </p>
      </section>
    </>
  );
}
