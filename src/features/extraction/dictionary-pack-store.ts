import type { DictionaryPack } from '@/domain/dictionary-pack';

/**
 * Session-only RAM store for an optional staged local dictionary pack.
 * Never persisted to IndexedDB, localStorage, or canonical backups; clears on reload.
 */
let activeSessionDictionaryPack: DictionaryPack | null = null;

export function getSessionDictionaryPack(): DictionaryPack | null {
  return activeSessionDictionaryPack;
}

export function setSessionDictionaryPack(pack: DictionaryPack | null): void {
  activeSessionDictionaryPack = pack;
}

export function clearSessionDictionaryPack(): void {
  activeSessionDictionaryPack = null;
}
