import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { publicRsvp, publicVote } from "@/app/actions/nights";
import { CategoryTag } from "@/components/badges";
import { Cover } from "@/components/cover";
import { LocalTime } from "@/components/local-time";
import { TimeOption } from "@/components/time-option";
import { RSVPS } from "@/db/schema";
import { formatMinutes } from "@/lib/length";
import { nightByToken, participantOf } from "@/lib/nights";
import { appOrigin } from "@/lib/origin";
import { currentUser } from "@/lib/session";
import { GuestForm } from "./guest-form";

// Looked up once per request, since both the page and its metadata need it.
const loadNight = cache(nightByToken);

/** The title and image chat apps show when this link is pasted, e.g. into WhatsApp. */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const v = await loadNight(token);
  const base = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
  if (!v) return { title: "Vote on a time", ...base };
  const title = `${v.host.name} is planning a night: ${v.item.title}`;
  const description = v.night.status === "voting" ? "Pick the times that work for you. No account needed." : "See when it is happening.";
  return {
    metadataBase: new URL(await appOrigin()),
    title: "Vote on a time",
    description,
    ...base,
    openGraph: { title, description, siteName: "Cheese", type: "website", images: v.item.coverUrl ? [{ url: v.item.coverUrl }] : undefined },
    twitter: { card: "summary", title, description },
  };
}

const RSVP_LABEL = { going: "Going", maybe: "Maybe", cant: "Can't" } as const;

/** What friends see when they open the link from WhatsApp. Works with just a name, no account. */
export default async function PublicNightPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await loadNight(token);
  if (!v) notFound();

  const me = await currentUser();
  const secret = (await cookies()).get(`cheese-night-${token.slice(0, 16)}`)?.value;
  // Who is looking: a signed-in person, a guest with a valid cookie, or nobody yet.
  const mine = me ? await participantOf(v.night.id, { userId: me.user.id }) : secret ? await participantOf(v.night.id, { guestSecret: secret }) : undefined;
  const who: "user" | "guest" | "none" = me ? "user" : mine ? "guest" : "none";
  const voting = v.night.status === "voting";
  const byId = new Map(v.participants.map((p) => [p.id, p]));
  const max = Math.max(0, ...v.options.map((o) => o.count));
  const myId = mine?.id;
  const myRsvp = v.participants.find((p) => p.id === myId)?.rsvp ?? null;

  return (
    <main className="page">
      <header>
        <h1 className="ch-title">{v.host.name} is planning a night</h1>
      </header>

      <section>
        <div className="ch-list">
          <div className="ch-lrow" style={{ gridTemplateColumns: "auto 1fr" }}>
            <Cover src={v.item.coverUrl} title={v.item.title} />
            <div className="ch-lrow__body">
              <p className="ch-row-title">{v.item.title}</p>
              <CategoryTag category={v.item.category} />
              <p className="ch-lrow__meta">{formatMinutes(v.options[0]?.durationMin ?? 0)}</p>
            </div>
          </div>
        </div>
        {v.night.note && <p className="hint" style={{ paddingTop: 8 }}>{v.night.note}</p>}
      </section>

      {v.night.status === "cancelled" && (
        <section>
          <p>This night was cancelled.</p>
        </section>
      )}

      {who === "none" && v.night.status !== "cancelled" && (
        <section className="stack">
          <p>{voting ? "Add your name to vote on a time." : "Add your name to say if you are coming."}</p>
          <GuestForm token={token} />
          <p className="hint">
            Already on Cheese? <Link href={`/login?next=${encodeURIComponent(`/n/${token}`)}`}>Sign in</Link> to vote as yourself.
          </p>
        </section>
      )}

      {voting && (
        <section className="sec">
          <p className="ch-overline">Pick the times that work</p>
          {v.options.map((o) => (
            <TimeOption
              key={o.id}
              startsAt={o.startsAt}
              durationMin={o.durationMin}
              hostZone={v.host.timezone}
              voters={o.voterIds.map((p) => byId.get(p)).filter((p): p is NonNullable<typeof p> => Boolean(p))}
              total={v.participants.length}
              voted={Boolean(myId && o.voterIds.includes(myId))}
              best={o.count === max && max > 1}
              voteAction={who === "none" ? undefined : publicVote.bind(null, token, o.id)}
            />
          ))}
          <p className="hint">Times are shown in your own timezone.</p>
        </section>
      )}

      {(v.night.status === "set" || v.night.status === "done") && v.chosen && (
        <section className="sec">
          <p className="ch-overline">{v.night.status === "done" ? "It happened" : "It is on"}</p>
          <div className="card stack">
            <p className="ch-card-title">
              <LocalTime iso={v.chosen.startsAt.toISOString()} hostZone={v.host.timezone} part="day" />
            </p>
            <p className="ch-heading">
              <LocalTime iso={v.chosen.startsAt.toISOString()} hostZone={v.host.timezone} part="time" /> · {formatMinutes(v.chosen.durationMin)}
            </p>
          </div>
          {v.night.status === "set" && who !== "none" && (
            <form action={publicRsvp.bind(null, token)} className="stack">
              <p className="ch-overline">Are you coming?</p>
              <div className="ch-seg" role="group" aria-label="Your answer">
                {RSVPS.map((r) => (
                  <button key={r} name="status" value={r} aria-pressed={myRsvp === r}>
                    {RSVP_LABEL[r]}
                  </button>
                ))}
              </div>
            </form>
          )}
          <p className="ch-overline" style={{ paddingTop: 8 }}>Who is coming</p>
          <div className="ch-list ch-list--card">
            {v.participants.filter((p) => p.rsvp).map((p) => (
              <div className="ch-lrow" key={p.id} style={{ gridTemplateColumns: "1fr auto" }}>
                <p className="ch-row-title">{p.name}</p>
                <span className="ch-caption">{p.rsvp ? RSVP_LABEL[p.rsvp] : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="hint">Made with Cheese, a place to keep track of what you want to watch, read and play.</p>
      </section>
    </main>
  );
}
