import Link from "next/link";
import { startEntry } from "@/app/actions/entry";
import { CategoryTag } from "@/components/badges";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { formatMinutes } from "@/lib/length";
import { loadCandidates } from "@/lib/home";
import { fitSuggestions } from "@/lib/suggest";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "I have time" };

const PRESETS = [30, 45, 60, 90, 120, 180];

function parseMinutes(v: string | undefined): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 5 && n <= 720 ? Math.round(n) : undefined;
}

export default async function FitPage({ searchParams }: { searchParams: Promise<{ minutes?: string }> }) {
  const { user } = await requireUser();
  const minutes = parseMinutes((await searchParams).minutes);
  const suggestions = minutes ? fitSuggestions(await loadCandidates(user.id), minutes) : [];

  return (
    <>
      <header className="head">
        <h1 className="ch-title">I have time</h1>
        <Link href="/" className="iconbtn" aria-label="Back to Home">
          <Icon name="x" />
        </Link>
      </header>

      <section className="stack">
        <p className="hint">How long do you have? You get three things that fit.</p>
        <div className="ch-chips" role="group" aria-label="Minutes available" style={{ paddingInline: 0, flexWrap: "wrap", overflow: "visible" }}>
          {PRESETS.map((m) => (
            <Link key={m} className="ch-chip" href={`/fit?minutes=${m}`} aria-current={minutes === m ? "true" : undefined}>
              {formatMinutes(m)}
            </Link>
          ))}
        </div>
        <form action="/fit" className="row">
          <div className="field grow">
            <label htmlFor="minutes" className="sr-only">
              Minutes
            </label>
            <input id="minutes" name="minutes" type="number" inputMode="numeric" min={5} max={720} className="input" placeholder="Another number of minutes" defaultValue={minutes && !PRESETS.includes(minutes) ? minutes : undefined} />
          </div>
          <button className="ch-btn ch-btn--ghost">Show</button>
        </form>
      </section>

      {minutes && (
        <section className="sec" aria-live="polite">
          {suggestions.length > 0 ? (
            <>
              <p className="ch-overline">Fits in {formatMinutes(minutes)}</p>
              <div className="ch-list ch-list--card">
                {suggestions.map((s) => (
                  <div className="ch-lrow" key={s.entryId}>
                    <Link href={`/item/${s.entryId}`} aria-label={`Open ${s.title}`}>
                      <Cover src={s.coverUrl} title={s.title} />
                    </Link>
                    <div className="ch-lrow__body">
                      <p className="ch-row-title">{s.title}</p>
                      <p className="ch-lrow__meta">
                        {s.chunk.label} · {formatMinutes(s.chunk.minutes)}
                        {s.reason ? ` · ${s.reason}` : ""}
                      </p>
                      <CategoryTag category={s.category} />
                    </div>
                    <form action={startEntry.bind(null, s.entryId)}>
                      <SubmitButton className="ch-btn ch-btn--pill is-accent">Start</SubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">
              <p>Nothing on your list fits in {formatMinutes(minutes)}. Try a bit longer.</p>
              <Link className="ch-btn ch-btn--ghost" href={`/fit?minutes=${Math.min(minutes * 2, 720)}`}>
                Try {formatMinutes(Math.min(minutes * 2, 720))}
              </Link>
            </div>
          )}
        </section>
      )}
    </>
  );
}
