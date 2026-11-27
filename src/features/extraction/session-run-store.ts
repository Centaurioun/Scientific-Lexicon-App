import type { ExtractionRun } from '@/domain/extraction';

/**
 * Strictly RAM-only session store for the active extraction run.
 * Cleared automatically on browser reload or explicit user Clear action.
 * Never persists raw source text to localStorage, sessionStorage, URLs, or IndexedDB.
 */
let currentSessionRun: ExtractionRun | null = null;

export function getSessionExtractionRun(): ExtractionRun | null {
  return currentSessionRun;
}

export function setSessionExtractionRun(run: ExtractionRun | null): void {
  currentSessionRun = run;
}

export function clearSessionExtractionRun(): void {
  currentSessionRun = null;
}
