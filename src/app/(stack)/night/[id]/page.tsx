import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { answerRsvp, changeTime, dropNight, finishNight, pickTime, vote } from "@/app/actions/nights";
import { AvatarStack } from "@/components/avatars";
import { CategoryTag } from "@/components/badges";
import { ConfirmAction } from "@/components/confirm-action";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { LocalTime } from "@/components/local-time";
import { ShareInvite } from "@/components/share-invite";
import { TimeOption } from "@/components/time-option";
import { RSVPS } from "@/db/schema";
import { formatMinutes } from "@/lib/length";
import { nightForMember } from "@/lib/nights";
import { appOrigin } from "@/lib/origin";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Night" };

const RSVP_LABEL = { going: "Going", maybe: "Maybe", cant: "Can't" } as const;

export default async function NightPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const v = await nightForMember(user.id, id);
  if (!v) notFound();

  const me = v.participants.find((p) => p.userId === user.id);
  const isHost = v.night.hostId === user.id;
  const voting = v.night.status === "voting";
  const byId = new Map(v.participants.map((p) => [p.id, p]));
  const max = Math.max(0, ...v.options.map((o) => o.count));
  const url = `${await appOrigin()}/n/${v.night.publicToken}`;
  const hostZone = v.host.timezone;

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Night</h1>
        <Link href={`/friends?group=${v.night.groupId}`} className="iconbtn" aria-label="Back to Friends">
          <Icon name="back" />
        </Link>
      </header>

      <section>
        <div className="ch-list">
          <div className="ch-lrow" style={{ gridTemplateColumns: "auto 1fr" }}>
            <Cover src={v.item.coverUrl} title={v.item.title} />
            <div className="ch-lrow__body">
              <p className="ch-row-title">{v.item.title}</p>
              <CategoryTag category={v.item.category} />
              <p className="ch-lrow__meta">
                {v.groupName} · proposed by {isHost ? "you" : v.host.name}
              </p>
            </div>
          </div>
        </div>
        {v.night.note && <p className="hint" style={{ paddingTop: 8 }}>{v.night.note}</p>}
      </section>

      {v.night.status === "cancelled" && (
        <section>
          <p className="hint">This night was cancelled.</p>
        </section>
      )}

      {voting && (
        <section className="sec">
          <p className="ch-overline">Pick a time that works</p>
          {v.options.map((o) => (
            <TimeOption
              key={o.id}
              startsAt={o.startsAt}
              durationMin={o.durationMin}
              hostZone={hostZone}
              voters={o.voterIds.map((p) => byId.get(p)).filter((p): p is NonNullable<typeof p> => Boolean(p))}
              total={v.participants.length}
              voted={Boolean(me && o.voterIds.includes(me.id))}
              best={o.count === max && max > 1}
              voteAction={vote.bind(null, v.night.id, o.id)}
              pickAction={isHost ? pickTime.bind(null, v.night.id, o.id) : undefined}
            />
          ))}
          <p className="hint">{isHost ? "When enough people can make it, pick the time. It goes on everyone's plan." : "Vote for every time that works. The person who proposed it will pick one."}</p>
        </section>
      )}

      {(v.night.status === "set" || v.night.status === "done") && v.chosen && (
        <section className="sec">
          <p className="ch-overline">{v.night.status === "done" ? "It happened" : "It is on"}</p>
          <div className="card stack">
            <p className="ch-card-title">
              <LocalTime iso={v.chosen.startsAt.toISOString()} hostZone={hostZone} part="day" />
            </p>
            <p className="ch-heading">
              <LocalTime iso={v.chosen.startsAt.toISOString()} hostZone={hostZone} part="time" /> · {formatMinutes(v.chosen.durationMin)}
            </p>
            <p className="hint">It is on your Plan and in your calendar link.</p>
          </div>

          {v.night.status === "set" && me && (
            <form action={answerRsvp.bind(null, v.night.id)} className="stack">
              <p className="ch-overline">Are you coming?</p>
              <div className="ch-seg" role="group" aria-label="Your answer">
                {RSVPS.map((r) => (
                  <button key={r} name="status" value={r} aria-pressed={me.rsvp === r}>
                    {RSVP_LABEL[r]}
                  </button>
                ))}
              </div>
            </form>
          )}

          <p className="ch-overline" style={{ paddingTop: 8 }}>Who is coming</p>
          <div className="ch-list ch-list--card">
            {v.participants.map((p) => (
              <div className="ch-lrow" key={p.id} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <AvatarStack people={[{ userId: p.id, displayName: p.name, avatarTone: p.avatarTone }]} />
                <div className="ch-lrow__body">
                  <p className="ch-row-title">{p.userId === user.id ? `${p.name} (you)` : p.name}</p>
                  {p.guest && <p className="ch-lrow__meta">Guest</p>}
                </div>
                <span className="ch-caption">{p.rsvp ? RSVP_LABEL[p.rsvp] : "No answer"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {v.night.status !== "cancelled" && (
        <section className="sec">
          <p className="ch-overline">Share</p>
          <p className="hint">Friends who are not on Cheese can vote and answer from this link, with just their name.</p>
          <ShareInvite url={url} message={`${v.host.name} is planning a night: ${v.item.title}. ${voting ? "Vote on a time:" : "Details:"}`} />
        </section>
      )}

      {isHost && v.night.status !== "cancelled" && (
        <section className="stack">
          {v.night.status === "set" && (
            <>
              <form action={finishNight.bind(null, v.night.id)}>
                <button className="ch-btn ch-btn--ghost ch-btn--block">We did it</button>
              </form>
              <form action={changeTime.bind(null, v.night.id)}>
                <button className="ch-btn ch-btn--ghost ch-btn--block">Change the time</button>
              </form>
            </>
          )}
          <ConfirmAction action={dropNight.bind(null, v.night.id)} label="Cancel this night" confirmLabel="Yes, cancel it" keepLabel="Keep it" />
        </section>
      )}
    </>
  );
}
