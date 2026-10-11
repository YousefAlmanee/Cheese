"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const THRESHOLD = 72; // how far to pull before a release triggers a refresh
const MAX = 96; // cap the visual pull so it never drags too far

/**
 * Pull down from the top of a tab page to refresh the server data, with a spinner that
 * follows the drag. This component owns the page's <main> so its children stay direct
 * descendants of .page (the horizontal padding rules depend on that). Only engages at the
 * very top and only for a real downward pull, so it never fights normal scrolling.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pull, setPull] = useState(0); // current drag distance in px (0 when idle)
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const armed = useRef(false);

  useEffect(() => {
    function onStart(e: TouchEvent) {
      // A swipe that starts on a sideways-scrolling row belongs to that row, never to refresh.
      const onRail = e.target instanceof Element && e.target.closest(".ch-tile-row, .ch-chips");
      if (window.scrollY <= 0 && e.touches.length === 1 && !onRail) {
        startY.current = e.touches[0].clientY;
        startX.current = e.touches[0].clientX;
        armed.current = true;
      } else {
        startY.current = null;
        armed.current = false;
      }
    }
    function onMove(e: TouchEvent) {
      if (!armed.current || startY.current === null || isPending) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;
      // Mostly sideways: give the gesture back to normal scrolling for good.
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        armed.current = false;
        startY.current = null;
        setPull(0);
        return;
      }
      if (dy <= 0 || window.scrollY > 0) {
        setPull(0);
        return;
      }
      const eased = Math.min(MAX, dy * 0.5); // resistance, capped
      setPull(eased);
      if (eased > 6 && e.cancelable) e.preventDefault(); // suppress native overscroll once clearly pulling
    }
    function onEnd() {
      if (!armed.current) return;
      armed.current = false;
      startY.current = null;
      setPull((p) => {
        if (p >= THRESHOLD) startTransition(() => router.refresh());
        return 0;
      });
    }
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [router, isPending]);

  const active = pull > 0 || isPending;
  const offset = isPending ? 44 : pull;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <>
      <div className="ch-ptr" aria-hidden={!active} style={{ opacity: active ? 1 : 0 }}>
        <span
          className={`ch-ptr__spin${isPending ? " ch-ptr__spin--go" : ""}`}
          style={{ transform: isPending ? undefined : `rotate(${progress * 270}deg) scale(${0.6 + progress * 0.4})` }}
        />
      </div>
      <main
        className="page page--tabs"
        style={{ transform: active ? `translateY(${offset}px)` : undefined, transition: pull === 0 ? "transform .2s ease" : undefined }}
      >
        {children}
      </main>
    </>
  );
}
