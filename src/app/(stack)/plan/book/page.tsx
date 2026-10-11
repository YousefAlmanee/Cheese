import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CategoryTag } from "@/components/badges";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { db } from "@/db";
import { entry, item } from "@/db/schema";
import { clockOf, isDay, parseClock, todayIn } from "@/lib/freetime";
import { loadCandidates } from "@/lib/home";
import { formatMinutes } from "@/lib/length";
import { requireUser } from "@/lib/session";
import { fitSuggestions } from "@/lib/suggest";
import { dayLabel } from "@/lib/time";
import { BookForm } from "./book-form";

export const metadata = { title: "Book a time" };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ entry?: string; day?: string; start?: string; gap?: string }> }) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const zone = profile.timezone;
  const day = isDay(sp.day) ? sp.day : todayIn(zone);
  const startMin = sp.start && parseClock(sp.start) != null ? (parseClock(sp.start) as number) : 20 * 60;
  const start = clockOf(Math.min(startMin, 1435));
  const gap = Math.max(5, Math.min(Number(sp.gap) || 60, 720));

  // Booking a specific item from its own page.
  if (sp.entry) {
    const entryId = z.uuid().safeParse(sp.entry); // a malformed id would make Postgres throw
    const rows = !entryId.success ? [] : await db.select({ e: entry, i: item }).from(entry).innerJoin(item, eq(entry.itemId, item.id)).where(and(eq(entry.id, entryId.data), eq(entry.userId, user.id)));
    const row = rows[0];
    if (!row) {
      return (
        <>
          <header className="head">
            <h1 className="ch-title">Book a time</h1>
            <Link href="/plan" className="iconbtn" aria-label="Back to Plan"><Icon name="back" /></Link>
          </header>
          <section><p className="hint">That item is not in your library.</p></section>
        </>
      );
    }
    return (
      <>
        <header className="head">
          <h1 className="ch-title">Book a time</h1>
          <Link href={`/item/${row.e.id}`} className="iconbtn" aria-label="Back to item"><Icon name="back" /></Link>
        </header>
        <section>
          <div className="ch-list">
            <div className="ch-lrow" style={{ gridTemplateColumns: "auto 1fr" }}>
              <Cover src={row.i.coverUrl} title={row.i.title} />
              <div className="ch-lrow__body">
                <p className="ch-row-title">{row.i.title}</p>
                <CategoryTag category={row.i.category} />
              </div>
            </div>
          </div>
        </section>
        <section>
          <BookForm entryId={row.e.id} day={day} start={start} durationMin={60} editable submitLabel="Book it" />
        </section>
      </>
    );
  }

  // Filling a gap on the Plan screen.
  const suggestions = fitSuggestions(await loadCandidates(user.id), gap, { limit: 4 });
  const when = `${dayLabel(new Date(`${day}T12:00:00Z`), "UTC")} from ${start}`;

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Fill the gap</h1>
        <Link href={`/plan?day=${day}`} className="iconbtn" aria-label="Back to Plan"><Icon name="back" /></Link>
      </header>
      <section className="sec">
        <p className="ch-overline">
          {when} · {formatMinutes(gap)} free
        </p>
        {suggestions.length === 0 ? (
          <div className="empty">
            <p>Nothing on your list fits in {formatMinutes(gap)}.</p>
            <Link className="ch-btn ch-btn--ghost" href="/add">
              Add something
            </Link>
          </div>
        ) : (
          <div className="ch-list ch-list--card">
            {suggestions.map((s) => (
              <div className="ch-lrow" key={s.entryId}>
                <Cover src={s.coverUrl} title={s.title} />
                <div className="ch-lrow__body">
                  <p className="ch-row-title">{s.title}</p>
                  <p className="ch-lrow__meta">
                    {s.chunk.label} · {formatMinutes(s.chunk.minutes)}
                    {s.reason ? ` · ${s.reason}` : ""}
                  </p>
                  <CategoryTag category={s.category} />
                </div>
                <BookForm entryId={s.entryId} label={s.chunk.label} units={s.chunk.units} day={day} start={start} durationMin={s.chunk.minutes} submitLabel="Book" pill />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
