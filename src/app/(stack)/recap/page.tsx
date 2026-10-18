import Link from "next/link";
import { Icon } from "@/components/icons";
import { formatMinutes } from "@/lib/length";
import { weeklyRecap } from "@/lib/recap";
import { requireUser } from "@/lib/session";
import { dayLabel } from "@/lib/time";

export const metadata = { title: "Your week" };

export default async function RecapPage() {
  const { user, profile } = await requireUser();
  const now = new Date();
  const r = await weeklyRecap(user.id, profile.timezone, now);
  const goal = profile.weeklyGoalMinutes;
  const pct = goal > 0 ? Math.min(100, Math.round((r.minutes / goal) * 100)) : 0;

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Your week</h1>
        <Link href="/" className="iconbtn" aria-label="Back to Home">
          <Icon name="x" />
        </Link>
      </header>

      <section className="sec">
        <p className="ch-overline">
          {dayLabel(r.from, profile.timezone)} to {dayLabel(now, profile.timezone)}
        </p>
        <p className="ch-card-title">{formatMinutes(r.minutes)} logged</p>
        {goal > 0 && (
          <p className="hint">
            {pct}% of your {formatMinutes(goal)} goal.
          </p>
        )}
      </section>

      <section className="sec">
        <p className="ch-overline">Finished</p>
        {r.finished.length === 0 ? (
          <p className="hint">Nothing finished yet this week.</p>
        ) : (
          <div className="ch-list ch-list--card">
            {r.finished.map((title, i) => (
              <div className="ch-lrow" key={`${title}-${i}`}>
                <div className="ch-lrow__body">
                  <p className="ch-row-title">{title}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="sec">
        <p className="ch-overline">Planned sessions</p>
        {r.sessionsPlanned === 0 ? (
          <p className="hint">No sessions were planned this week.</p>
        ) : (
          <p>
            {r.sessionsDone} of {r.sessionsPlanned} done.
          </p>
        )}
        <Link className="ch-btn ch-btn--ghost ch-btn--block" href="/plan">
          Plan next week
        </Link>
      </section>
    </>
  );
}
