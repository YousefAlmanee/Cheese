import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { startOver } from "@/app/actions/swipe";
import { AvatarStack } from "@/components/avatars";
import { CategoryTag } from "@/components/badges";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { CATEGORY_LABEL, formatMinutes, totalMinutes } from "@/lib/length";
import { requireUser } from "@/lib/session";
import { loadDeck, loadResults } from "@/lib/swipe";
import { SubmitButton } from "@/components/submit-button";
import { SwipeDeck, type Card } from "./swipe-deck";

export const metadata = { title: "Swipe to pick" };

export default async function SwipePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [deck, results] = await Promise.all([loadDeck(user.id, id), loadResults(user.id, id)]);
  if (!deck || !results) notFound();

  const cards: Card[] = deck.todo.map((r) => {
    const mins = totalMinutes(r.item);
    return {
      id: r.item.id,
      title: r.item.title,
      kind: CATEGORY_LABEL[r.item.category],
      coverUrl: r.item.coverUrl,
      meta: [r.item.year, mins != null ? formatMinutes(mins) : null].filter(Boolean).join(" · "),
      who: r.who.map((p) => (p.userId === user.id ? "you" : p.displayName)).join(", "),
    };
  });
  const answered = deck.total - deck.todo.length;

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Swipe to pick</h1>
        <Link href={`/friends?group=${deck.groupId}`} className="iconbtn" aria-label={`Back to ${deck.groupName}`}>
          <Icon name="back" />
        </Link>
      </header>

      {deck.total === 0 ? (
        <section>
          <div className="empty">
            <p>{deck.members.length < 2 ? "Add friends to this group first." : "Nothing the group wants in common yet. Swiping starts once two of you want the same thing."}</p>
            <Link className="ch-btn ch-btn--ghost" href={`/friends?group=${deck.groupId}`}>
              Back to {deck.groupName}
            </Link>
          </div>
        </section>
      ) : cards.length > 0 ? (
        <section>
          <p className="ch-overline" style={{ marginBottom: "var(--space-2)" }}>
            {deck.groupName} · {answered} of {deck.total} done
          </p>
          <SwipeDeck groupId={deck.groupId} cards={cards} />
        </section>
      ) : (
        <section>
          <p className="ch-overline">{deck.groupName}</p>
          <p className="hint">You have been through all {deck.total}. Others may still be swiping, so this list can change.</p>
        </section>
      )}

      {results.length > 0 && (
        <section className="sec">
          <p className="ch-overline">Said yes</p>
          <div className="ch-list ch-list--card">
            {results.map(({ row, yes, everyone }) => (
              <div className="ch-lrow" key={row.item.id} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <Cover src={row.item.coverUrl} title={row.item.title} />
                <div className="ch-lrow__body">
                  <p className="ch-row-title">{row.item.title}</p>
                  <div className="row">
                    <CategoryTag category={row.item.category} />
                    <span className="ch-lrow__meta">{everyone ? "Everyone said yes" : `${yes.length} of ${deck.members.length} said yes`}</span>
                  </div>
                  <AvatarStack people={yes} size="sm" />
                </div>
                <Link className="ch-btn ch-btn--pill is-accent" href={`/night/new?group=${deck.groupId}&item=${row.item.id}`} aria-label={`Plan a night for ${row.item.title}`}>
                  Plan
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {answered > 0 && (
        <section>
          <form action={startOver.bind(null, deck.groupId)}>
            <SubmitButton className="ch-btn ch-btn--ghost ch-btn--block">Start over with my answers</SubmitButton>
          </form>
          <p className="hint" style={{ paddingTop: 8 }}>Only your own answers are cleared.</p>
        </section>
      )}
    </>
  );
}
