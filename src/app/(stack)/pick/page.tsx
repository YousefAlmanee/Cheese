import Link from "next/link";
import { startEntry } from "@/app/actions/entry";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { CATEGORIES, type Category } from "@/db/schema";
import { CATEGORY_LABEL, CATEGORY_PLURAL, formatMinutes } from "@/lib/length";
import { loadCandidates } from "@/lib/home";
import { requireUser } from "@/lib/session";
import { nextUpText, pickForMe } from "@/lib/suggest";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Pick for me" };

export default async function PickPage({ searchParams }: { searchParams: Promise<{ category?: string; quick?: string; exclude?: string }> }) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const category = CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : undefined;
  const quick = sp.quick === "1";
  const all = await loadCandidates(user.id);
  const pick = pickForMe(all, { category, fitMinutes: quick ? 90 : undefined, exclude: sp.exclude });
  const chosen = pick ? all.find((c) => c.entryId === pick.entryId) : undefined;

  const q = (over: { category?: string; quick?: string }) => {
    const p = new URLSearchParams();
    const c = "category" in over ? over.category : category;
    const k = "quick" in over ? over.quick : quick ? "1" : undefined;
    if (c) p.set("category", c);
    if (k) p.set("quick", k);
    const s = p.toString();
    return s ? `/pick?${s}` : "/pick";
  };

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Pick for me</h1>
        <Link href="/" className="iconbtn" aria-label="Back to Home">
          <Icon name="x" />
        </Link>
      </header>

      <div className="ch-chips" role="group" aria-label="Category">
        <Link className="ch-chip ch-chip--quiet" href={q({ category: undefined })} aria-current={!category ? "true" : undefined}>
          Anything
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c} className="ch-chip ch-chip--quiet" href={q({ category: c })} aria-current={category === c ? "true" : undefined}>
            {CATEGORY_PLURAL[c]}
          </Link>
        ))}
      </div>
      <div className="ch-chips" role="group" aria-label="Length">
        <Link className="ch-chip ch-chip--quiet" href={q({ quick: undefined })} aria-current={!quick ? "true" : undefined}>
          Any length
        </Link>
        <Link className="ch-chip ch-chip--quiet" href={q({ quick: "1" })} aria-current={quick ? "true" : undefined}>
          Under 90 min
        </Link>
      </div>

      <section aria-live="polite">
        {pick && chosen ? (
          <article className="ch-spot">
            <Link href={`/item/${pick.entryId}`} aria-label={`Open ${pick.title}`} style={{ display: "block" }}>
              <Cover src={pick.coverUrl} title={pick.title} />
            </Link>
            <div className="ch-spot__body">
              <p className="ch-overline">Tonight, try</p>
              <h2 className="ch-card-title">{pick.title}</h2>
              <p className="ch-spot__meta">
                {CATEGORY_LABEL[pick.category]} · {nextUpText(chosen)}
                {pick.chunk.minutes ? ` · ${formatMinutes(pick.chunk.minutes)}` : ""}
              </p>
              <div className="ch-spot__actions">
                <form action={startEntry.bind(null, pick.entryId)} style={{ display: "contents" }}>
                  <SubmitButton className="ch-btn ch-btn--primary">
                    <Icon name="play" small /> Start
                  </SubmitButton>
                </form>
                <Link className="ch-btn ch-btn--ghost" href={`${q({})}${q({}).includes("?") ? "&" : "?"}exclude=${pick.entryId}`}>
                  Pick again
                </Link>
              </div>
            </div>
          </article>
        ) : (
          <div className="empty">
            <p>{sp.exclude ? "That is everything that matches. Loosen a filter or go back." : "Nothing on your list matches that."}</p>
            <Link className="ch-btn ch-btn--ghost" href="/pick">
              Clear filters
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
