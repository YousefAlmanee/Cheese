import Link from "next/link";
import { Icon } from "@/components/icons";
import { Cover } from "@/components/cover";
import { STATUS_LABEL } from "@/components/badges";
import { CATEGORIES, STATUSES, type Category, type Status } from "@/db/schema";
import { percent, shortProgress } from "@/lib/progress";
import { CATEGORY_LABEL, CATEGORY_PLURAL } from "@/lib/length";
import { libraryGenres, listLibrary, PAGE_SIZE, parseFilter, SORT_LABEL, SORTS, statusCounts, type LibraryFilter } from "@/lib/library-query";
import { requireUser } from "@/lib/session";
import { shortDate } from "@/lib/time";

export const metadata = { title: "Library" };

function href(f: LibraryFilter, over: Partial<Record<keyof LibraryFilter | "priority", string | undefined>>, search = false) {
  const p = new URLSearchParams();
  const merged = {
    status: f.status,
    category: f.category,
    sort: f.sort === "recent" ? undefined : f.sort,
    priority: f.mustOnly ? "must" : undefined,
    genre: f.genre,
    q: f.q,
    ...over,
  } as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  if (search) p.set("search", "1");
  const s = p.toString();
  return s ? `/library?${s}` : "/library";
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const showSearch = sp.search === "1" || Boolean(f.q);
  const shown = Math.min(Math.max(Number(Array.isArray(sp.n) ? sp.n[0] : sp.n) || PAGE_SIZE, PAGE_SIZE), 1000);
  const [{ rows, total }, counts, genres] = await Promise.all([listLibrary(user.id, f, shown), statusCounts(user.id), libraryGenres(user.id)]);

  const moreHref = href(f, {}).includes("?") ? `${href(f, {})}&` : `${href(f, {})}?`;
  const heading = f.status ? STATUS_LABEL[f.status] : "Everything";

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Library</h1>
        <div className="head__end">
          <Link className="iconbtn" href={showSearch ? href(f, { q: undefined }) : href(f, {}, true)} aria-label={showSearch ? "Close search" : "Search library"}>
            <Icon name={showSearch ? "x" : "search"} />
          </Link>
        </div>
      </header>

      {showSearch && (
        <form action="/library" role="search">
          {f.status && <input type="hidden" name="status" value={f.status} />}
          {f.category && <input type="hidden" name="category" value={f.category} />}
          <label className="ch-search">
            <Icon name="search" />
            <input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Search your library" aria-label="Search your library" autoFocus />
          </label>
        </form>
      )}

      <div className="ch-chips" role="group" aria-label="Status">
        <Link className="ch-chip" href={href(f, { status: undefined })} aria-current={!f.status ? "true" : undefined}>
          All
        </Link>
        {STATUSES.map((s: Status) => (
          <Link key={s} className="ch-chip" href={href(f, { status: s })} aria-current={f.status === s ? "true" : undefined}>
            {STATUS_LABEL[s]}
            {counts[s] > 0 && <span className="muted" style={{ marginLeft: 6 }}>{counts[s]}</span>}
          </Link>
        ))}
      </div>
      <div className="ch-chips" role="group" aria-label="Category">
        <Link className="ch-chip ch-chip--quiet" href={href(f, { category: undefined })} aria-current={!f.category ? "true" : undefined}>
          All
        </Link>
        {CATEGORIES.map((c: Category) => (
          <Link key={c} className="ch-chip ch-chip--quiet" href={href(f, { category: c })} aria-current={f.category === c ? "true" : undefined}>
            {CATEGORY_PLURAL[c]}
          </Link>
        ))}
      </div>

      <section className="sec">
        <div className="row row--between">
          <p className="ch-overline">
            {heading} · {rows.length}
          </p>
          <details className="menu">
            <summary>Sort and filter</summary>
            <div className="menu__panel card stack">
              <div className="stack" style={{ gap: "var(--space-1)" }}>
                <p className="ch-overline">Sort by</p>
                {SORTS.map((s) => (
                  <Link key={s} className="menu__item" href={href(f, { sort: s === "recent" ? undefined : s })} aria-current={f.sort === s ? "true" : undefined}>
                    {SORT_LABEL[s]}
                  </Link>
                ))}
              </div>
              <div className="stack" style={{ gap: "var(--space-1)" }}>
                <p className="ch-overline">Priority</p>
                <Link className="menu__item" href={href(f, { priority: undefined })} aria-current={!f.mustOnly ? "true" : undefined}>
                  All
                </Link>
                <Link className="menu__item" href={href(f, { priority: "must" })} aria-current={f.mustOnly ? "true" : undefined}>
                  Must do only
                </Link>
              </div>
              {genres.length > 0 && (
                <div className="stack" style={{ gap: "var(--space-1)" }}>
                  <p className="ch-overline">Genre</p>
                  <Link className="menu__item" href={href(f, { genre: undefined })} aria-current={!f.genre ? "true" : undefined}>
                    All
                  </Link>
                  {genres.map((g) => (
                    <Link key={g} className="menu__item" href={href(f, { genre: g })} aria-current={f.genre === g ? "true" : undefined}>
                      {g}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <p>{counts.all === 0 ? "Nothing here yet. Add the first thing you want to get to." : "Nothing matches these filters."}</p>
            {counts.all === 0 ? (
              <Link className="ch-btn ch-btn--primary" href="/add">
                Add something
              </Link>
            ) : (
              <Link className="ch-btn ch-btn--ghost" href="/library">
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <div className="ch-tile-grid">
            {rows.map(({ entry: e, item: it }) => {
              const total = e.totalOverride ?? it.totalUnits;
              const pct = percent(e.progress, total);
              const showBar = (e.status === "in_progress" || e.status === "paused") && pct != null;
              const prog =
                e.status === "done" && e.finishedAt
                  ? ` · ${shortDate(e.finishedAt, profile.timezone)}`
                  : e.progress > 0 && it.unit !== "watch"
                    ? ` · ${shortProgress(it.unit, e.progress)}`
                    : "";
              return (
                <Link key={e.id} href={`/item/${e.id}`} className="ch-tile" style={{ textDecoration: "none" }}>
                  <Cover src={it.coverUrl} title={it.title} />
                  {showBar && (
                    <div className="ch-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${it.title} progress`}>
                      <span style={{ ["--w" as string]: `${pct}%` }} />
                    </div>
                  )}
                  <div>
                    <div className="ch-tile__title">{it.title}</div>
                    <div className="ch-tile__meta">
                      {CATEGORY_LABEL[it.category]}
                      {prog}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        {total > rows.length && (
          <Link className="ch-btn ch-btn--ghost ch-btn--block" href={`${moreHref}n=${rows.length + PAGE_SIZE}`} scroll={false}>
            Show more ({total - rows.length} left)
          </Link>
        )}
      </section>
    </>
  );
}
