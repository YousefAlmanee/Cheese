"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { answerSwipe } from "@/app/actions/swipe";
import { Cover } from "@/components/cover";
import { Icon } from "@/components/icons";

export type Card = { id: string; title: string; kind: string; coverUrl: string | null; meta: string; who: string };

const THRESHOLD = 90;

/** One card at a time. Drag it right for yes and left for no, or use the buttons or the arrow keys. */
export function SwipeDeck({ groupId, cards }: { groupId: string; cards: Card[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(cards);
  const [dx, setDx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const start = useRef<number | null>(null);
  // Answers are sent one per card and do not wait for each other, so a quick second swipe is never lost.
  const sent = useRef(new Set<string>());
  const pending = useRef(0);
  const left = useRef(cards.length);
  const top = queue[0];

  async function answer(liked: boolean) {
    if (!top || sent.current.has(top.id)) return;
    const card = top;
    sent.current.add(card.id);
    pending.current++;
    left.current--;
    setError(null);
    setDx(0);
    setQueue((q) => q.filter((c) => c.id !== card.id));
    const r = await answerSwipe(groupId, card.id, liked);
    pending.current--;
    if (!r.ok) {
      sent.current.delete(card.id);
      left.current++;
      setQueue((q) => [card, ...q]);
      setError(r.error);
      return;
    }
    setSaid(`${liked ? "Yes" : "No"} to ${card.title}.${r.unanimous ? " Everyone said yes." : ""}`);
    // Show the results once the last answer is safely saved.
    if (left.current === 0 && pending.current === 0) router.refresh();
  }

  if (!top) return null;
  const hint = dx > 30 ? "yes" : dx < -30 ? "no" : null;

  return (
    <div className="stack" onKeyDown={(e) => (e.key === "ArrowRight" ? answer(true) : e.key === "ArrowLeft" ? answer(false) : undefined)}>
      <p className="hint" id="swipe-help">
        {queue.length} left. Drag the card, use the arrow keys, or tap a button.
      </p>
      <article
        className={`ch-swipe${hint ? ` ch-swipe--${hint}` : ""}`}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 20}deg)` }}
        tabIndex={0}
        aria-describedby="swipe-help"
        aria-label={`${top.title}, ${top.kind}`}
        onPointerDown={(e) => {
          start.current = e.clientX;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => start.current != null && setDx(e.clientX - start.current)}
        onPointerUp={() => {
          const moved = dx;
          start.current = null;
          if (Math.abs(moved) >= THRESHOLD) void answer(moved > 0);
          else setDx(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
      >
        <Cover src={top.coverUrl} title={top.title} />
        <div className="ch-swipe__body">
          <p className="ch-overline">{top.kind}</p>
          <h2 className="ch-card-title">{top.title}</h2>
          {top.meta && <p className="ch-spot__meta">{top.meta}</p>}
          <p className="hint">Wanted by {top.who}</p>
        </div>
      </article>
      <div className="row" style={{ gap: "var(--space-2)" }}>
        <button className="ch-btn ch-btn--ghost grow" onClick={() => answer(false)}>
          <Icon name="x" small /> Not for me
        </button>
        <button className="ch-btn ch-btn--primary grow" onClick={() => answer(true)}>
          <Icon name="check" small /> Yes
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
    </div>
  );
}
