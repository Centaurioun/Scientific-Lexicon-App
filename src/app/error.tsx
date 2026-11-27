'use client';

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  return (
    <main className="shell" role="alert">
      <section className="setup-card">
        <p className="status-label">APPLICATION ERROR</p>
        <h2>Workspace recovery required</h2>
        <p>
          An unexpected client error interrupted the current view. Your local IndexedDB library is
          not modified by render errors.
        </p>
        <p className="error-detail">{error.message || 'Unknown rendering error.'}</p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Retry workspace
        </button>
      </section>
    </main>
  );
}
