"use client";

import { useState, useTransition } from "react";

/**
 * A button that asks "are you sure?" before running a server action that cannot be undone.
 * The first tap swaps the button for a confirm and a cancel; only the confirm runs the action.
 */
export function ConfirmAction({
  action,
  label,
  confirmLabel,
  keepLabel = "Keep it",
  danger = true,
}: {
  action: () => Promise<void>;
  label: string;
  confirmLabel: string;
  keepLabel?: string;
  danger?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const tone = danger ? "ch-btn ch-btn--ghost ch-btn--danger" : "ch-btn ch-btn--ghost";
  return confirming ? (
    <div className="row">
      <button className={`${tone} grow`} disabled={pending} onClick={() => start(() => action())}>
        {confirmLabel}
      </button>
      <button className="ch-btn ch-btn--ghost" disabled={pending} onClick={() => setConfirming(false)}>
        {keepLabel}
      </button>
    </div>
  ) : (
    <button className={`${tone} ch-btn--block`} onClick={() => setConfirming(true)}>
      {label}
    </button>
  );
}
