"use client";

import { useFormStatus } from "react-dom";

/** A submit button that turns itself off while its form's server action is running, so a double tap cannot send it twice. */
export function SubmitButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return <button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending || undefined} />;
}
