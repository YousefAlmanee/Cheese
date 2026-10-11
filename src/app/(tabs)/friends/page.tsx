import Link from "next/link";
import { answerRequest } from "@/app/actions/friends";
import { Avatar, AvatarStack } from "@/components/avatars";
import { CategoryTag } from "@/components/badges";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { CATEGORIES, type Category } from "@/db/schema";
import { loadGroupView } from "@/lib/common";
import { listFriends, listGroups, listRequests } from "@/lib/friends";
import { CATEGORY_PLURAL, formatMinutes, totalMinutes } from "@/lib/length";
import { upcomingNights } from "@/lib/nights";
import { requireUser } from "@/lib/session";
import { dayLabel, timeLabel } from "@/lib/time";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Friends" };

type SP = { group?: string; category?: string; under?: string; platform?: string };

export default async function FriendsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const [groups, friends, requests] = await Promise.all([listGroups(user.id), listFriends(user.id), listRequests(user.id)]);

  const selected = groups.find((g) => g.id === sp.group) ?? groups[0];
  const category = CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : undefined;
  const under = sp.under === "120" ? 120 : undefined;
  const same = sp.platform === "same";
  const [view, nights] = selected
    ? await Promise.all([loadGroupView(user.id, selected.id, { category, underMinutes: under, samePlatform: same }), upcomingNights(selected.id)])
    : [null, []];

  const href = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { group: selected?.id, category: sp.category, under: sp.under, platform: sp.platform, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/friends?${s}` : "/friends";
  };

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Friends</h1>
        <div className="head__end">
          <Link href="/friends/people" className="iconbtn" aria-label="People">
            <Icon name="users" />
          </Link>
          <Link href="/friends/add" className="iconbtn" aria-label="Add a friend">
            <Icon name="plus" />
          </Link>
        </div>
      </header>

      {requests.incoming.length > 0 && (
        <section className="stack">
          {requests.incoming.map((p) => (
            <div className="card row row--between" key={p.userId}>
              <div className="row grow" style={{ minWidth: 0 }}>
                <Avatar person={p} />
                <div style={{ minWidth: 0 }}>
                  <p className="ch-row-title">{p.displayName}</p>
                  <p className="ch-lrow__meta">wants to be friends</p>
                </div>
              </div>
              <form action={answerRequest.bind(null, p.userId, true)}>
                <SubmitButton className="ch-btn ch-btn--pill is-accent">Accept</SubmitButton>
              </form>
              <form action={answerRequest.bind(null, p.userId, false)}>
                <SubmitButton className="ch-btn ch-btn--pill">Decline</SubmitButton>
              </form>
            </div>
          ))}
        </section>
      )}

      {friends.length === 0 && groups.length === 0 ? (
        <section>
          <div className="empty">
            <p>Invite a friend to see what you both want to do.</p>
            <Link className="ch-btn ch-btn--primary" href="/friends/add">
              Invite a friend
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div className="ch-chips" role="group" aria-label="Group">
            {groups.map((g) => (
              <Link key={g.id} className="ch-chip" href={href({ group: g.id, category: undefined, under: undefined, platform: undefined })} aria-current={g.id === selected?.id ? "true" : undefined}>
                {g.name}
              </Link>
            ))}
            <Link className="ch-chip ch-chip--quiet" href="/friends/group/new">
              + New group
            </Link>
          </div>

          {!selected && (
            <section>
              <div className="empty">
                <p>Make a group to see what you all want to do together.</p>
                <Link className="ch-btn ch-btn--primary" href="/friends/group/new">
                  Make a group
                </Link>
              </div>
            </section>
          )}

          {selected && view && (
            <>
              <section>
                <Link href={`/friends/group/${selected.id}`} className="ch-match" style={{ textDecoration: "none", color: "inherit" }} aria-label={`${selected.name}, group details`}>
                  <AvatarStack people={view.group.members} size="lg" />
                  <div>
                    {view.match != null ? (
                      <p className="ch-match__pct">
                        {view.match}%<span>taste match</span>
                      </p>
                    ) : (
                      <p className="ch-match__pct" style={{ fontSize: 20, lineHeight: "28px" }}>
                        <span>Not enough to compare yet</span>
                      </p>
                    )}
                    <p className="ch-match__sub">
                      {view.totalCommon === 0
                        ? view.group.members.length < 2
                          ? "Add friends to this group"
                          : "Nothing you all want yet"
                        : `${view.totalCommon} ${view.totalCommon === 1 ? "thing" : "things"} you all want`}
                    </p>
                  </div>
                </Link>
              </section>

              {nights.length > 0 && (
                <section className="sec">
                  <p className="ch-overline">Coming up</p>
                  <div className="ch-list ch-list--card">
                    {nights.map(({ n, i, startsAt }) => (
                      <Link key={n.id} className="ch-lrow" href={`/night/${n.id}`} style={{ gridTemplateColumns: "auto 1fr auto", textDecoration: "none", color: "inherit" }}>
                        <Cover src={i.coverUrl} title={i.title} />
                        <div className="ch-lrow__body">
                          <p className="ch-row-title">{i.title}</p>
                          <p className="ch-lrow__meta">{n.status === "set" && startsAt ? `${dayLabel(startsAt, profile.timezone)} · ${timeLabel(startsAt, profile.timezone)}` : "Voting on a time"}</p>
                        </div>
                        <span className="ch-count">{n.status === "set" ? "On" : "Vote"}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <div className="ch-chips" role="group" aria-label="Filters">
                <Link className="ch-chip ch-chip--quiet" href={href({ category: undefined })} aria-current={!category ? "true" : undefined}>
                  Everything
                </Link>
                {CATEGORIES.map((c) => (
                  <Link key={c} className="ch-chip ch-chip--quiet" href={href({ category: c })} aria-current={category === c ? "true" : undefined}>
                    {CATEGORY_PLURAL[c]}
                  </Link>
                ))}
                <Link className="ch-chip ch-chip--quiet" href={href({ under: under ? undefined : "120" })} aria-current={under ? "true" : undefined}>
                  Under 2h
                </Link>
                <Link className="ch-chip ch-chip--quiet" href={href({ platform: same ? undefined : "same" })} aria-current={same ? "true" : undefined}>
                  Same platform
                </Link>
              </div>

              <section className="sec">
                <p className="ch-overline">You all want</p>
                {view.rows.length === 0 ? (
                  <div className="empty">
                    <p>
                      {view.totalCommon > 0
                        ? "Nothing matches those filters."
                        : "Nothing in common yet. Mark things Together on your list, and ask your friends to do the same."}
                    </p>
                    {view.totalCommon > 0 ? (
                      <Link className="ch-btn ch-btn--ghost" href={href({ category: undefined, under: undefined, platform: undefined })}>
                        Clear filters
                      </Link>
                    ) : (
                      <Link className="ch-btn ch-btn--ghost" href="/library">
                        Open my library
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="ch-list ch-list--card">
                    {view.rows.map((r) => {
                      const mins = totalMinutes(r.item);
                      return (
                        <Link key={r.item.id} className="ch-lrow" href={`/friends/item/${r.item.id}?group=${selected.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                          <Cover src={r.item.coverUrl} title={r.item.title} />
                          <div className="ch-lrow__body">
                            <p className="ch-row-title">{r.item.title}</p>
                            <p className="ch-lrow__meta">{mins ? formatMinutes(mins) : "Length unknown"}</p>
                            <CategoryTag category={r.item.category} />
                          </div>
                          <span className="ch-count" aria-label={`${r.count} of ${view.group.members.length} want this`}>
                            {r.count}/{view.group.members.length}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
