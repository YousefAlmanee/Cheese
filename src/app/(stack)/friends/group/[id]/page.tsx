import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { addMember, deleteGroupAction, kickMember, leaveGroupAction, renameGroupAction } from "@/app/actions/friends";
import { Avatar } from "@/components/avatars";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionForm } from "@/components/form-field";
import { Icon } from "@/components/icons";
import { getGroup, listFriends } from "@/lib/friends";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Group" };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const group = await getGroup(user.id, id);
  if (!group) notFound();
  const friends = await listFriends(user.id);
  const inGroup = new Set(group.members.map((m) => m.userId));
  const addable = friends.filter((f) => !inGroup.has(f.userId));
  const owner = group.ownerId === user.id;

  return (
    <>
      <header className="head">
        <h1 className="ch-title">{group.name}</h1>
        <Link href={`/friends?group=${group.id}`} className="iconbtn" aria-label="Back to Friends">
          <Icon name="back" />
        </Link>
      </header>

      <section className="sec">
        <p className="ch-overline">People · {group.members.length}</p>
        <div className="ch-list ch-list--card">
          {group.members.map((m) => (
            <div className="ch-lrow" key={m.userId} style={{ gridTemplateColumns: "auto 1fr auto" }}>
              <Avatar person={m} />
              <div className="ch-lrow__body">
                <p className="ch-row-title">{m.userId === user.id ? `${m.displayName} (you)` : m.displayName}</p>
                <p className="ch-lrow__meta">{m.userId === group.ownerId ? "Made this group" : `@${m.username}`}</p>
              </div>
              {owner && m.userId !== user.id && (
                <form action={kickMember.bind(null, group.id, m.userId)}>
                  <button className="ch-btn ch-btn--pill" aria-label={`Remove ${m.displayName} from the group`}>Remove</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </section>

      {addable.length > 0 && (
        <section className="sec">
          <p className="ch-overline">Add a friend</p>
          <form action={addMember.bind(null, group.id)} className="row">
            <div className="field grow">
              <label htmlFor="friend" className="sr-only">Friend</label>
              <select id="friend" name="friend" className="select">
                {addable.map((f) => (
                  <option key={f.userId} value={f.userId}>
                    {f.displayName} (@{f.username})
                  </option>
                ))}
              </select>
            </div>
            <button className="ch-btn ch-btn--ghost">Add</button>
          </form>
        </section>
      )}

      {owner && (
        <section className="sec">
          <p className="ch-overline">Rename</p>
          <ActionForm action={renameGroupAction.bind(null, group.id)} submit="Save name" ghost>
            <div className="field">
              <label htmlFor="name" className="sr-only">Group name</label>
              <input id="name" name="name" className="input" defaultValue={group.name} maxLength={40} required />
            </div>
          </ActionForm>
        </section>
      )}

      <section className="stack">
        <ConfirmAction action={leaveGroupAction.bind(null, group.id)} label="Leave group" confirmLabel="Yes, leave" danger={false} />
        {owner && <ConfirmAction action={deleteGroupAction.bind(null, group.id)} label="Delete group for everyone" confirmLabel="Yes, delete it" keepLabel="Keep it" />}
      </section>
    </>
  );
}
