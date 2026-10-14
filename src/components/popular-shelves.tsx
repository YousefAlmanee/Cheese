"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { addToLibrary } from "@/app/actions/library";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { discoverHref } from "@/lib/discover";
import { CATEGORIES, type Category, type Status } from "@/db/schema";
import { CATEGORY_LABEL, CATEGORY_PLURAL } from "@/lib/length";
import type { ItemDraft } from "@/lib/providers/types";

type Response = {
  hits: ItemDraft[];
  unavailable: Category[];
  inLibrary: Record<string, { entryId: string; status: Status }>;
};

const key = (h: { source: string; externalId: string | null }) => `${h.source}:${h.externalId}`;

/**
 * Discovery shelves shown before anyone searches: one horizontal, scrollable row per category
 * (Movies, Series, Anime, Manga, Books, Games), each tile a cover + title + the same Add button
 * search results use. Results are cached per category on the client so switching is instant.
 */
export function PopularShelves({ category }: { category?: Category }) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState<Record<string, { entryId: string; status: Status }>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const cache = useRef<Map<string, Response>>(new Map());
  const catKey = category ?? "all";

  useEffect(() => {
    const cached = cache.current.get(catKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/popular${category ? `?category=${category}` : ""}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Response;
        cache.current.set(catKey, json);
        setData(json);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setData(null);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [catKey, category]);

  function add(h: ItemDraft) {
    const k = key(h);
    if (!h.externalId || h.source === "manual") return;
    setPending((p) => new Set(p).add(k));
    startTransition(async () => {
      const res = await addToLibrary({ source: h.source, externalId: h.externalId, category: h.category });
      setPending((p) => {
        const n = new Set(p);
        n.delete(k);
        return n;
      });
      if (res.ok) setAdded((a) => ({ ...a, [k]: { entryId: res.entryId, status: "want" } }));
    });
  }

  if (loading && !data) return <p className="hint">Loading popular titles…</p>;
  if (!data || data.hits.length === 0) {
    return <p className="hint">Type a title to search — movies, series, anime, manga, books and games together.</p>;
  }

  const inLib = { ...(data.inLibrary ?? {}), ...added };
  const order = category ? [category] : CATEGORIES;
  const groups = order.map((c) => ({ c, items: data.hits.filter((h) => h.category === c) })).filter((g) => g.items.length > 0);

  return (
    <div className="stack">
      {data.unavailable.length > 0 && (
        <p className="hint">Popular {data.unavailable.map((c) => CATEGORY_PLURAL[c].toLowerCase()).join(", ")} are not set up on this server yet.</p>
      )}
      {groups.map(({ c, items }) => (
        <section className="sec" key={c}>
          <p className="ch-overline">{CATEGORY_PLURAL[c]}</p>
          <div className="ch-tile-row">
            {items.map((h) => {
              const k = key(h);
              const existing = inLib[k];
              return (
                <div className="ch-tile" key={k}>
                  {(() => {
                    // Cover and title open the details page, so a title can be read about before it is added.
                    const href = existing ? `/item/${existing.entryId}` : discoverHref(h);
                    const body = (
                      <>
                        <Cover src={h.coverUrl} title={h.title} />
                        <div className="ch-tile__title">{h.title}</div>
                      </>
                    );
                    return href ? (
                      <Link href={href} aria-label={`Details for ${h.title}`} style={{ display: "flex", flexDirection: "column", gap: 6, color: "inherit", textDecoration: "none" }}>
                        {body}
                      </Link>
                    ) : (
                      body
                    );
                  })()}
                  {existing ? (
                    <Link href={`/item/${existing.entryId}`} className="ch-btn ch-btn--pill ch-btn--block" style={{ justifyContent: "center" }} aria-label={`Open ${h.title}`}>
                      <Icon name="check" small /> Added
                    </Link>
                  ) : (
                    <button
                      className="ch-btn ch-btn--pill ch-btn--block"
                      style={{ justifyContent: "center" }}
                      onClick={() => add(h)}
                      disabled={pending.has(k)}
                      aria-label={`Add ${h.title} (${CATEGORY_LABEL[h.category]})`}
                    >
                      <Icon name="plus" small /> {pending.has(k) ? "Adding" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
