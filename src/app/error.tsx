"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <header>
        <h1 className="ch-title">Something went wrong</h1>
      </header>
      <section>
        <div className="empty">
          <p>That didn&apos;t work. Try again, and if it keeps happening, go back home.</p>
          <div className="row">
            <button className="ch-btn ch-btn--primary" onClick={() => retry()}>
              Try again
            </button>
            <Link className="ch-btn ch-btn--ghost" href="/">
              Back home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
