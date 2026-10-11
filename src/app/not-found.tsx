import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <header>
        <h1 className="ch-title">Not found</h1>
      </header>
      <section>
        <div className="empty">
          <p>That page doesn&apos;t exist, or it isn&apos;t shared with you.</p>
          <Link className="ch-btn ch-btn--primary" href="/">
            Back home
          </Link>
        </div>
      </section>
    </main>
  );
}
