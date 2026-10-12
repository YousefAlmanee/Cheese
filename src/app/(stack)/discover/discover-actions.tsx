"use client";

import { useState, useTransition } from "react";
import { addWithStatus } from "@/app/actions/library";
import { Icon } from "@/components/icons";
import type { Category, Source } from "@/db/schema";
import { DONE_LABEL } from "@/lib/discover";

type Ref = { source: Exclude<Source, "manual">; externalId: string; category: Category };

/** Add a title without opening it from your list first: as something you want, are starting, or have already finished. */
export function DiscoverActions({ reference }: { reference: Ref }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function go(status: "want" | "in_progress" | "done") {
    setError(null);
    setBusy(status);
    startTransition(async () => {
      const res = await addWithStatus(reference, status);
      // A successful add redirects to the item page, so getting a result back means it failed.
      if (res && !res.ok) {
        setError(res.error);
        setBusy(null);
      }
    });
  }

  return (
    <section className="stack">
      <button className="ch-btn ch-btn--primary ch-btn--block" onClick={() => go("want")} disabled={pending}>
        <Icon name="plus" small /> {busy === "want" ? "Adding" : "Add to my list"}
      </button>
      <div className="row" style={{ gap: "var(--space-2)" }}>
        <button className="ch-btn ch-btn--ghost grow" onClick={() => go("in_progress")} disabled={pending}>
          <Icon name="play" small /> {busy === "in_progress" ? "Starting" : "Start"}
        </button>
        <button className="ch-btn ch-btn--ghost grow" onClick={() => go("done")} disabled={pending}>
          <Icon name="check" small /> {busy === "done" ? "Saving" : DONE_LABEL[reference.category]}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
