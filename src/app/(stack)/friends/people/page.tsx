import Link from "next/link";
import { answerRequest } from "@/app/actions/friends";
import { Avatar } from "@/components/avatars";
import { Icon } from "@/components/icons";
import { matchesWith } from "@/lib/common";
import { findPersonByUsername, listFriends, listRequests } from "@/lib/friends";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  const { user } = await requireUser();
  const [friends, requests, sp] = await Promise.all([listFriends(user.id), listRequests(user.id), searchParams]);
  const matches = await matchesWith(user.id, friends.map((f) => f.userId));
  const added = sp.added ? await findPersonByUsername(sp.added) : null;

  return (
    <>
      <header className="head">
        <h1 className="ch-title">People</h1>
        <Link href="/friends" className="iconbtn" aria-label="Back to Friends">
          <Icon name="back" />
        </Link>
      </header>

      {added && friends.some((f) => f.userId === added.userId) && (
        <section>
          <p className="hint" role="status">You and {added.displayName} are now friends.</p>
        </section>
      )}

      {requests.incoming.length > 0 && (
        <section className="sec">
          <p className="ch-overline">Wants to be your friend</p>
          <div className="ch-list ch-list--card">
            {requests.incoming.map((p) => (
              <div className="ch-lrow" key={p.userId} style={{ gridTemplateColumns: "auto 1fr auto auto" }}>
                <Avatar person={p} />
                <div className="ch-lrow__body">
                  <p className="ch-row-title">{p.displayName}</p>
                  <p className="ch-lrow__meta">@{p.username}</p>
                </div>
                <form action={answerRequest.bind(null, p.userId, true)}>
                  <SubmitButton className="ch-btn ch-btn--pill is-accent">Accept</SubmitButton>
                </form>
                <form action={answerRequest.bind(null, p.userId, false)}>
                  <SubmitButton className="ch-btn ch-btn--pill">Decline</SubmitButton>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="sec">
        <p className="ch-overline">Friends · {friends.length}</p>
        {friends.length === 0 ? (
          <div className="empty">
            <p>No friends here yet.</p>
            <Link className="ch-btn ch-btn--primary" href="/friends/add">
              Invite a friend
            </Link>
          </div>
        ) : (
          <div className="ch-list ch-list--card">
            {friends.map((f) => {
              const m = matches.get(f.userId);
              return (
                <Link key={f.userId} className="ch-lrow" href={`/friends/u/${f.username}`} style={{ gridTemplateColumns: "auto 1fr auto", textDecoration: "none", color: "inherit" }}>
                  <Avatar person={f} />
                  <div className="ch-lrow__body">
                    <p className="ch-row-title">{f.displayName}</p>
                    <p className="ch-lrow__meta">@{f.username}</p>
                  </div>
                  {m != null && <span className="ch-count">{m}%</span>}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {requests.outgoing.length > 0 && (
        <section className="sec">
          <p className="ch-overline">Waiting for an answer</p>
          <div className="ch-list ch-list--card">
            {requests.outgoing.map((p) => (
              <div className="ch-lrow" key={p.userId} style={{ gridTemplateColumns: "auto 1fr" }}>
                <Avatar person={p} />
                <div className="ch-lrow__body">
                  <p className="ch-row-title">{p.displayName}</p>
                  <p className="ch-lrow__meta">@{p.username}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
