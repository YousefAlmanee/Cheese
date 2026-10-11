/** Instant placeholder shown via loading.tsx while a page's server data loads, so navigation feels immediate. */
export function PageSkeleton({ rows = 6, chips = false }: { rows?: number; chips?: boolean }) {
  return (
    <div aria-hidden="true" aria-busy="true">
      <header className="head">
        <span className="ch-skel ch-skel--line" style={{ width: 120, height: 24 }} />
      </header>

      {chips && (
        <div className="ch-chips">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="ch-skel ch-skel--chip" style={{ width: i === 0 ? 48 : 68 }} />
          ))}
        </div>
      )}

      <section className="sec">
        <div className="ch-list">
          {Array.from({ length: rows }).map((_, i) => (
            <div className="ch-lrow" key={i}>
              <span className="ch-skel ch-skel--cover" />
              <div className="ch-lrow__body" style={{ gap: 8, width: "100%" }}>
                <span className="ch-skel ch-skel--line" style={{ width: `${70 - (i % 3) * 12}%` }} />
                <span className="ch-skel ch-skel--line" style={{ width: `${40 - (i % 2) * 8}%`, height: 10 }} />
              </div>
              <span className="ch-skel ch-skel--pill" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
