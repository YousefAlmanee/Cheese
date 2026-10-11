import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { deleteSession, markSessionDone } from "@/app/actions/plan";
import { CategoryTag } from "@/components/badges";
import { ConfirmAction } from "@/components/confirm-action";
import { Icon } from "@/components/icons";
import { formatMinutes } from "@/lib/length";
import { getOwnSession } from "@/lib/sessions";
import { requireUser } from "@/lib/session";
import { clock24, dayLabel } from "@/lib/time";
import { DateTime } from "luxon";

export const metadata = { title: "Session" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, profile } = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getOwnSession(user.id, id);
  if (!row) notFound();
  const { s, i } = row;
  const zone = profile.timezone;
  const end = new Date(s.startsAt.getTime() + s.durationMin * 60_000);
  const day = DateTime.fromJSDate(s.startsAt, { zone }).toISODate();

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Session</h1>
        <Link href={`/plan?day=${day}`} className="iconbtn" aria-label="Back to Plan">
          <Icon name="back" />
        </Link>
      </header>

      <section className="stack">
        <div className="card stack">
          <h2 className="ch-card-title">{s.title}</h2>
          {(s.category ?? i?.category) && <div className="row"><CategoryTag category={(s.category ?? i?.category) as NonNullable<typeof s.category>} /></div>}
          <p className="ch-row-title">
            {dayLabel(s.startsAt, zone)} · {clock24(s.startsAt, zone)} to {clock24(end, zone)}
          </p>
          <p className="hint">{formatMinutes(s.durationMin)}</p>
          {s.note && <p>{s.note}</p>}
          {s.done && <p className="hint">Done.</p>}
        </div>

        {!s.done && (
          <form action={markSessionDone.bind(null, s.id)} className="stack">
            <button className="ch-btn ch-btn--primary ch-btn--block">Mark done</button>
            <p className="hint">
              {s.units && i ? `Adds ${s.units} ${s.units === 1 ? "unit" : "units"} to your progress on ${i.title} and counts the time toward your week.` : "Counts the time toward your week."}
            </p>
          </form>
        )}
        {s.nightId && (
          <Link className="ch-btn ch-btn--ghost ch-btn--block" href={`/night/${s.nightId}`}>
            Open the night with friends
          </Link>
        )}
        <ConfirmAction action={deleteSession.bind(null, s.id)} label="Remove this session" confirmLabel="Yes, remove it" keepLabel="Keep it" />
      </section>
    </>
  );
}
