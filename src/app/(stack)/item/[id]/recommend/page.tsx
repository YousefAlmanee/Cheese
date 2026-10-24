import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { sendRecommendation } from "@/app/actions/recommend";
import { Avatar } from "@/components/avatars";
import { Cover } from "@/components/cover";
import { ActionForm } from "@/components/form-field";
import { Icon } from "@/components/icons";
import { getOwnEntry } from "@/lib/entries";
import { CATEGORY_LABEL } from "@/lib/length";
import { friendsToRecommendTo, MAX_NOTE } from "@/lib/recommendations";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Recommend" };

export default async function RecommendPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getOwnEntry(user.id, id);
  if (!row) notFound();
  const { entry: e, item: it } = row;
  const recipients = e.hidden ? [] : await friendsToRecommendTo(user.id, it.id);
  const open = recipients.filter((r) => !r.alreadySent);

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Recommend</h1>
        <Link href={`/item/${e.id}`} className="iconbtn" aria-label={`Back to ${it.title}`}>
          <Icon name="back" />
        </Link>
      </header>

      <section className="card row">
        <div style={{ width: 56, flex: "none" }}>
          <Cover src={it.coverUrl} title={it.title} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <p className="ch-row-title">{it.title}</p>
          <p className="ch-lrow__meta">{CATEGORY_LABEL[it.category]}</p>
        </div>
      </section>

      <section>
        {e.hidden ? (
          <div className="empty">
            <p>This is hidden from friends, so it cannot be recommended. Turn on &quot;Show to friends&quot; first.</p>
            <Link className="ch-btn ch-btn--ghost" href={`/item/${e.id}`}>
              Back to the item
            </Link>
          </div>
        ) : recipients.length === 0 ? (
          <div className="empty">
            <p>No friends to send this to. Either you have no friends yet, or they all have it already.</p>
            <Link className="ch-btn ch-btn--primary" href="/friends/add">
              Invite a friend
            </Link>
          </div>
        ) : (
          <ActionForm action={sendRecommendation.bind(null, e.id)} submit="Send">
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="lbl" style={{ padding: 0 }}>Who should try it</legend>
              <div className="ch-list ch-list--card">
                {recipients.map(({ person: f, alreadySent }) => (
                  <label className="ch-lrow" key={f.userId} style={{ gridTemplateColumns: "auto 1fr auto", cursor: alreadySent ? "default" : "pointer" }}>
                    <Avatar person={f} />
                    <div className="ch-lrow__body">
                      <p className="ch-row-title">{f.displayName}</p>
                      <p className="ch-lrow__meta">{alreadySent ? "Already sent" : `@${f.username}`}</p>
                    </div>
                    <input type="checkbox" name="friend" value={f.userId} disabled={alreadySent} style={{ width: 22, height: 22 }} aria-label={`Recommend to ${f.displayName}`} />
                  </label>
                ))}
              </div>
            </fieldset>
            {open.length === 0 && <p className="hint">You have sent this to everyone who can get it.</p>}
            <div className="field">
              <label htmlFor="note">Add a note (optional)</label>
              <input id="note" name="note" className="input" maxLength={MAX_NOTE} placeholder="You will love the ending" autoComplete="off" />
            </div>
          </ActionForm>
        )}
      </section>
    </>
  );
}
