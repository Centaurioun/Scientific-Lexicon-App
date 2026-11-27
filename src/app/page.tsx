import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';

export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main className="shell">
        <header className="masthead">
          <p className="eyebrow">SCIENTIFIC LEXICON</p>
          <h1>TermForge</h1>
          <p className="lede">
            A private, local-first concept-centric workbench for scientific terminology in English
            and Turkish. All canonical records, local NLP candidate discovery, exports, and backups
            remain inside your browser.
          </p>
        </header>

        <section className="overview-grid" aria-label="Implemented workspaces">
          <article className="overview-card">
            <div>
              <p className="status-label">TERMINOLOGY</p>
              <h2>Bilingual Library</h2>
              <p>
                Manage independent scientific concepts and English, Turkish, or shared expressions
                with exact Unicode preservation, case-sensitive search, user-confirmed assertions,
                and immutable change approvals.
              </p>
            </div>
            <div>
              <Link href="/library" className="btn btn-primary">
                Open Library
              </Link>
            </div>
          </article>

          <article className="overview-card">
            <div>
              <p className="status-label">DISCOVERY &amp; REVIEW</p>
              <h2>Scientific Extraction</h2>
              <p>
                Analyze pasted English text or local UTF-8 TXT files using Aho–Corasick matching and
                Wink NLP candidate discovery. Session-only by default with explicit opt-in local
                source retention.
              </p>
            </div>
            <div>
              <Link href="/extraction" className="btn btn-primary">
                Open Extraction
              </Link>
            </div>
          </article>

          <article className="overview-card">
            <div>
              <p className="status-label">INTERCHANGE &amp; RECOVERY</p>
              <h2>Export &amp; Recovery</h2>
              <p>
                Generate deterministic TXT, Markdown, formula-safe CSV, and JSON presentation
                exports, create SHA-256 verified portable backups, and restore atomically into an
                empty library.
              </p>
            </div>
            <div>
              <Link href="/exchange" className="btn btn-primary">
                Open Export &amp; Recovery
              </Link>
            </div>
          </article>
        </section>

        <footer>
          The production library starts empty. Synthetic fixtures only until G4 real-data readiness
          and S3 intake safeguards are satisfied.
        </footer>
      </main>
    </>
  );
}
