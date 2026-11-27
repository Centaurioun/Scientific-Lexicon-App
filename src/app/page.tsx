export default function HomePage() {
  return (
    <main className="shell">
      <header className="masthead">
        <p className="eyebrow">SCIENTIFIC LEXICON</p>
        <h1>TermForge</h1>
        <p className="lede">A private, local-first workspace for scientific terminology.</p>
      </header>

      <section className="setup-card" aria-labelledby="setup-title">
        <p className="status-label">APPLICATION STARTER</p>
        <h2 id="setup-title">Library setup</h2>
        <p>
          The application shell is ready. The terminology library and its local storage will be
          created as WP01 is implemented.
        </p>
      </section>

      <footer>Start with the approved WP01 handoff. The library begins empty.</footer>
    </main>
  );
}
