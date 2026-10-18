"use client";

/** Ticks or unticks every checkbox in the form around it. */
export function SelectAll({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="ch-btn ch-btn--ghost"
      onClick={(e) => {
        const boxes = Array.from(e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="id"]') ?? []);
        const all = boxes.length > 0 && boxes.every((b) => b.checked);
        boxes.forEach((b) => (b.checked = !all));
      }}
    >
      {label}
    </button>
  );
}
