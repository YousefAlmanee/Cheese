import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { wantToo } from "@/app/actions/friends";
import { AvatarStack } from "@/components/avatars";
import { CategoryTag, StatusBadge } from "@/components/badges";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";
import { loadGroupView } from "@/lib/common";
import { CATEGORY_LABEL, formatMinutes, totalMinutes } from "@/lib/length";
import { requireUser } from "@/lib/session";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Together" };

/** One thing a group wants: who wants it, and what to do about it. Only reachable through a group you are in. */
export default async function GroupItemPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ group?: string }> }) {
  const { user } = await requireUser();
  const { itemId } = await params;
  const { group: groupId } = await searchParams;
  if (!z.uuid().safeParse(itemId).success || !z.uuid().safeParse(groupId).success) notFound();
  const view = await loadGroupView(user.id, groupId as string);
  const row = view?.rows.find((r) => r.item.id === itemId);
  if (!view || !row) notFound();
  const it = row.item;
  const mins = totalMinutes(it);
  const here = `/friends/item/${it.id}?group=${view.group.id}`;

  return (
    <>
      <header className="head">
        <Link href={`/friends?group=${view.group.id}`} className="iconbtn" aria-label={`Back to ${view.group.name}`}>
          <Icon name="back" />
        </Link>
        <span className="ch-caption">{CATEGORY_LABEL[it.category]}</span>
        <span style={{ width: "var(--size-tap)" }} />
      </header>

      <section style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
        <div style={{ width: 104, flex: "none" }}>
          <Cover src={it.coverUrl} title={it.title} />
        </div>
        <div className="stack" style={{ gap: "var(--space-2)", paddingBottom: 4, minWidth: 0 }}>
          <h1 className="ch-title">{it.title}</h1>
          <div className="row"><CategoryTag category={it.category} /></div>
          {it.creator && <span className="ch-caption">{[it.year, it.creator].filter(Boolean).join(" · ")}</span>}
          {mins != null && <span className="ch-caption">{formatMinutes(mins)}</span>}
        </div>
      </section>

      <section>
        <div className="card stack">
          <p className="ch-overline">{view.group.name}</p>
          <p className="ch-heading">
            {row.count} of {view.group.members.length} want this
          </p>
          <AvatarStack people={row.who} />
          <p className="hint">{row.who.map((p) => (p.userId === user.id ? "You" : p.displayName)).join(", ")}</p>
        </div>
      </section>

      {it.summary && (
        <section>
          <p className="hint">{it.summary}</p>
        </section>
      )}

      <section className="stack">
        <Link className="ch-btn ch-btn--primary ch-btn--block" href={`/night/new?group=${view.group.id}&item=${it.id}`}>
          Plan a night
        </Link>
        {row.mine ? (
          <Link href={`/item/${row.mine.id}`} className="row" style={{ textDecoration: "none" }} aria-label={`Open ${it.title} in my library`}>
            <StatusBadge status={row.mine.status} />
            <span className="hint">It is on your list.</span>
          </Link>
        ) : (
          <form action={wantToo.bind(null, it.id, here, true)}>
            <SubmitButton className="ch-btn ch-btn--ghost ch-btn--block">I want this too</SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
