"use client";

// Replaces the root layout, so the stylesheets are not loaded here and the styling is inline.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, font: "16px/24px system-ui, sans-serif", background: "#0e0f13", color: "#f5f5f7" }}>
        <main style={{ maxWidth: 520, margin: "0 auto", padding: "48px 16px" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 24px", opacity: 0.8 }}>The app hit a problem it couldn&apos;t recover from.</p>
          <button
            onClick={() => retry()}
            style={{ minHeight: 44, padding: "0 20px", border: 0, borderRadius: 12, font: "700 15px system-ui", background: "#ff5a36", color: "#1b1c20" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
