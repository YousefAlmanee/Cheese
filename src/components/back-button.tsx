"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";

/** Goes back to wherever the person came from (Home, Add or Search), or to a fallback page when there is nothing to go back to. */
export function BackButton({ fallback, label }: { fallback: string; label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={label}
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
    >
      <Icon name="back" />
    </button>
  );
}
