import { DateTime } from "luxon";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { listNotifications } from "@/lib/notifications";
import { requireUser } from "@/lib/session";
import { MarkRead } from "./mark-read";

export const metadata = { title: "Notifications" };

function timeAgo(date: Date): string {
  return DateTime.fromJSDate(date).toRelative({ style: "short" }) ?? "";
}

export default async function NotificationsPage() {
  const { user } = await requireUser();
  const items = await listNotifications(user.id);

  return (
    <>
      <header className="head">
        <h1 className="ch-title">Notifications</h1>
        <Link href="/" className="iconbtn" aria-label="Back to Home">
          <Icon name="x" />
        </Link>
      </header>

      <MarkRead />

      <section className="sec">
        {items.length === 0 ? (
          <p className="hint">Nothing yet. Friend requests, movie-night invites and votes will show up here.</p>
        ) : (
          <div className="ch-list">
            {items.map((n) => {
              const inner = (
                <>
                  <div className="ch-lrow__body">
                    <p className="ch-row-title">{n.title}</p>
                    {n.body && <p className="ch-lrow__meta">{n.body}</p>}
                    <p className="ch-lrow__meta">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.readAt && <span className="ch-unread-dot" aria-label="Unread" />}
                </>
              );
              return n.url ? (
                <Link className="ch-lrow" key={n.id} href={n.url}>
                  {inner}
                </Link>
              ) : (
                <div className="ch-lrow" key={n.id}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
