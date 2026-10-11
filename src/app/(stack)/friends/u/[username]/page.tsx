import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { unfriend, wantToo } from "@/app/actions/friends";
import { Avatar } from "@/components/avatars";
import { CategoryTag, StatusBadge } from "@/components/badges";
import { ConfirmAction } from "@/components/confirm-action";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { StarRating } from "@/components/star-rating";
import { db } from "@/db";
import { entry } from "@/db/schema";
import { matchesWith } from "@/lib/common";
import { findPersonByUsername, friendLibrary } from "@/lib/friends";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Friend" };

export default async function FriendPage({ params }: { params: Promise<{ username: string }> }) {
  const { user } = await requireUser();
  const { username } = await params;
  const person = await findPersonByUsername(username);
  if (!person) notFound();
  const lib = await friendLibrary(user.id, person.userId);
  if (!lib) notFound(); // not a friend: show nothing, and do not reveal whether the person exists

  const [matches, mine] = await Promise.all([
    matchesWith(user.id, [person.userId]),
    db.select({ itemId: entry.itemId, id: entry.id, status: entry.status }).from(entry).where(eq(entry.userId, user.id)),
  ]);
  const match = matches.get(person.userId);
  const have = new Map(mine.map((m) => [m.itemId, m]));
  const wanting = lib.rows.filter(({ e }) => e.status === "want" || e.status === "in_progress" || e.status === "paused");
  const done = lib.rows.filter(({ e }) => e.status === "done");
  const back = `/friends/u/${person.username}`;

  const row = ({ e, i }: (typeof lib.rows)[number], showRating: boolean) => {
    const owned = have.get(i.id);
    return (
      <div className="ch-lrow" key={e.id}>
        <Cover src={i.coverUrl} title={i.title} />
        <div className="ch-lrow__body">
          <p className="ch-row-title">{i.title}</p>
          <CategoryTag category={i.category} />
          {showRating && e.ratingHalf != null && <StarRating value={e.ratingHalf} label={`${person.displayName} rated ${i.title}`} />}
        </div>
        {owned ? (
          <Link href={`/item/${owned.id}`} aria-label={`Open ${i.title}`}>
            <StatusBadge status={owned.status} />
          </Link>
        ) : (
          <form action={wantToo.bind(null, i.id, back, false)}>
            <button className="ch-btn ch-btn--pill" aria-label={`Add ${i.title} to my list`}>
              <Icon name="plus" small /> Add
            </button>
          </form>
        )}
      </div>
    );
  };

  return (
    <>
      <header className="head">
        <h1 className="ch-title">{person.displayName}</h1>
        <Link href="/friends/people" className="iconbtn" aria-label="Back to People">
          <Icon name="back" />
        </Link>
      </header>

      <section>
        <div className="card row">
          <Avatar person={person} size="lg" />
          <div className="grow">
            <p className="ch-row-title">@{person.username}</p>
            <p className="hint">{match != null ? `${match}% taste match with you` : "Not enough to compare yet"}</p>
          </div>
        </div>
      </section>

      <section className="sec">
        <p className="ch-overline">Wants to do · {wanting.length}</p>
        {wanting.length === 0 ? <p className="hint">Nothing they want to share right now.</p> : <div className="ch-list ch-list--card">{wanting.map((r) => row(r, false))}</div>}
      </section>

      <section className="sec">
        <p className="ch-overline">Finished · {done.length}</p>
        {done.length === 0 ? <p className="hint">Nothing finished yet.</p> : <div className="ch-list ch-list--card">{done.map((r) => row(r, true))}</div>}
      </section>

      <section>
        <ConfirmAction action={unfriend.bind(null, person.userId)} label={`Remove ${person.displayName} as a friend`} confirmLabel="Yes, remove" keepLabel="Keep" />
        <p className="hint" style={{ paddingTop: 8 }}>Things you hid are never shown to friends.</p>
      </section>
    </>
  );
}
