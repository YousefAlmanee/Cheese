import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BackButton } from "@/components/back-button";
import { CategoryTag, StatusBadge } from "@/components/badges";
import { Cover } from "@/components/cover";
import { db } from "@/db";
import { CATEGORIES, SOURCES, entry, item } from "@/db/schema";
import { friendsWithItem } from "@/lib/friends";
import { CATEGORY_LABEL, lengthLine } from "@/lib/length";
import { fetchDetails, type ItemDraft } from "@/lib/providers";
import { requireUser } from "@/lib/session";
import { DiscoverActions } from "./discover-actions";

export const metadata = { title: "Details" };

const query = z.object({
  source: z.enum(SOURCES).exclude(["manual"]),
  id: z.string().min(1).max(40),
  c: z.enum(CATEGORIES),
});

/** A title that is not in your list yet: read about it, see which friends have it, and add it however you like. */
export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await requireUser();
  const parsed = query.safeParse(await searchParams);

  const back = <BackButton fallback="/add" label="Back" />;
  if (!parsed.success) {
    return (
      <>
        <header className="head">{back}</header>
        <section>
          <p className="hint">That title could not be opened.</p>
        </section>
      </>
    );
  }
  const { source, id: externalId, c: category } = parsed.data;

  // Already in the list: the full item page is the right place.
  const [existing] = await db
    .select({ id: item.id })
    .from(item)
    .where(and(eq(item.source, source), eq(item.externalId, externalId)));
  if (existing) {
    const [mine] = await db.select({ id: entry.id }).from(entry).where(and(eq(entry.userId, user.id), eq(entry.itemId, existing.id)));
    if (mine) redirect(`/item/${mine.id}`);
  }

  let draft: ItemDraft | null = null;
  try {
    draft = await fetchDetails({ source, externalId, category });
  } catch {
    draft = null;
  }
  if (!draft) {
    return (
      <>
        <header className="head">{back}</header>
        <section>
          <p className="error">Could not load that title right now. Try again in a moment.</p>
        </section>
      </>
    );
  }

  const friends = existing ? await friendsWithItem(user.id, existing.id) : [];
  const length = lengthLine(draft, null);
  const sub = [draft.year, draft.creator].filter(Boolean).join(" · ");

  return (
    <>
      <header className="head">
        {back}
        <span className="ch-caption">{CATEGORY_LABEL[draft.category]}</span>
        <span style={{ width: "var(--size-tap)" }} />
      </header>

      <section style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
        <div style={{ width: 104, flex: "none" }}>
          <Cover src={draft.coverUrl} title={draft.title} />
        </div>
        <div className="stack" style={{ gap: "var(--space-2)", paddingBottom: 4, minWidth: 0 }}>
          <h1 className="ch-title">{draft.title}</h1>
          <div className="row">
            <CategoryTag category={draft.category} />
          </div>
          {sub && <span className="ch-caption">{sub}</span>}
          {length && <span className="ch-caption">{length}</span>}
        </div>
      </section>

      <DiscoverActions reference={{ source, externalId, category }} />

      <section>
        <div className="card stack">
          <p className="ch-overline">Friends</p>
          {friends.length === 0 ? (
            <p className="hint">None of your friends have this in their list yet.</p>
          ) : (
            <div className="ch-list">
              {friends.map((f) => (
                <div className="ch-lrow" key={f.person.userId} style={{ gridTemplateColumns: "1fr auto" }}>
                  <div className="ch-lrow__body">
                    <p className="ch-row-title">{f.person.displayName}</p>
                    {f.ratingHalf != null && <p className="ch-lrow__meta">Rated {f.ratingHalf / 2} out of 5</p>}
                  </div>
                  <StatusBadge status={f.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {draft.genres.length > 0 && (
        <section>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {draft.genres.slice(0, 6).map((g) => (
              <span key={g} className="ch-tag">
                {g}
              </span>
            ))}
          </div>
        </section>
      )}

      {draft.summary && (
        <section>
          <p className="ch-overline" style={{ marginBottom: "var(--space-2)" }}>About</p>
          <p className="hint">{draft.summary}</p>
        </section>
      )}

      {draft.category === "game" && draft.platforms.length > 0 && (
        <section>
          <p className="hint">Platforms: {draft.platforms.join(", ")}</p>
        </section>
      )}
    </>
  );
}
