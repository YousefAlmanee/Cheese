"use client";

import { useState, useTransition } from "react";
import { saveRecapEnabled } from "@/app/actions/reminders";

export function RecapSettings({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function choose(next: boolean) {
    const before = on;
    setOn(next);
    setError(null);
    start(async () => {
      const r = await saveRecapEnabled(next);
      if (!r.ok) {
        setOn(before);
        setError("Could not save.");
      }
    });
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="lbl" id="recap-label">Sunday evening recap</span>
        <div className="ch-seg" role="group" aria-labelledby="recap-label">
          <button aria-pressed={on} onClick={() => choose(true)}>On</button>
          <button aria-pressed={!on} onClick={() => choose(false)}>Off</button>
        </div>
        <p className="hint">A short summary of your week: time logged, what you finished, and sessions kept. It reaches you in the app, and as a reminder on devices you turned reminders on for.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
