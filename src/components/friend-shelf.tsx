"use client";

import Link from "next/link";
import { useState } from "react";
import { Cover } from "@/components/cover";
import { CATEGORIES, type Category } from "@/db/schema";
import { CATEGORY_LABEL, CATEGORY_PLURAL } from "@/lib/length";
import type { Person } from "@/lib/friends";
import type { SharedItem } from "@/lib/home-friends";

/** One friend's shared items, with its own kind filter so each section can be narrowed on its own. */
export function FriendShelfSection({ friend, items }: { friend: Person; items: SharedItem[] }) {
  const [category, setCategory] = useState<Category | undefined>();
  // Only offer kinds this section actually has, so no chip leads to an empty row.
  const kinds = CATEGORIES.filter((c) => items.some((i) => i.category === c));
  const shown = category ? items.filter((i) => i.category === category) : items;

  return (
    <section className="sec" aria-label={`In common with ${friend.displayName}`}>
      <Link href={`/friends/u/${friend.username}`} className="ch-overline" style={{ color: "inherit", textDecoration: "none" }}>
        With {friend.displayName} · {shown.length}
      </Link>
      {kinds.length > 1 && (
        <div className="ch-chips" role="group" aria-label={`Kind of item with ${friend.displayName}`}>
          <button className="ch-chip" aria-pressed={!category} onClick={() => setCategory(undefined)}>
            All
          </button>
          {kinds.map((c) => (
            <button key={c} className="ch-chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {CATEGORY_PLURAL[c]}
            </button>
          ))}
        </div>
      )}
      <div className="ch-tile-row">
        {shown.map((c) => (
          <Link key={c.entryId} href={`/item/${c.entryId}`} className="ch-tile" style={{ textDecoration: "none", color: "inherit" }}>
            <Cover src={c.coverUrl} title={c.title} />
            <div>
              <div className="ch-tile__title">{c.title}</div>
              <div className="ch-tile__meta">{CATEGORY_LABEL[c.category]}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
