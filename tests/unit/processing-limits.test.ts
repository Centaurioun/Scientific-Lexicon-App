import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROCESSING_LIMITS,
  MAX_BACKUP_FILE_BYTES,
  MAX_CANDIDATE_OCCURRENCES,
  MAX_TEXT_UTF16_CODE_UNITS,
  MAX_TXT_INPUT_BYTES,
  MIN_CANDIDATE_OCCURRENCES,
  OccurrenceLimitExceededError,
  OccurrenceLimitTracker,
  parseProcessingLimits,
} from '@/domain/processing-limits';
import {
  PROCESSING_LIMITS_STORAGE_KEY,
  readProcessingLimits,
  writeProcessingLimits,
} from '@/features/extraction/processing-limits-store';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('operational processing limits', () => {
  it('exposes authorized defaults and hard bounds', () => {
    expect(DEFAULT_PROCESSING_LIMITS).toEqual({
      maxTxtInputBytes: 2_097_152,
      maxTextUtf16CodeUnits: 200_000,
      maxCandidateOccurrences: 5_000,
    });
    expect(MAX_TXT_INPUT_BYTES).toBe(2_097_152);
    expect(MAX_TEXT_UTF16_CODE_UNITS).toBe(200_000);
    expect(MIN_CANDIDATE_OCCURRENCES).toBe(100);
    expect(MAX_CANDIDATE_OCCURRENCES).toBe(10_000);
    expect(MAX_BACKUP_FILE_BYTES).toBe(16_777_216);
  });

  it('validates downward input caps and candidate limits within the authorized range', () => {
    expect(parseProcessingLimits({
      maxTxtInputBytes: 1_024,
      maxTextUtf16CodeUnits: 500,
      maxCandidateOccurrences: 100,
    })).toEqual({ maxTxtInputBytes: 1_024, maxTextUtf16CodeUnits: 500, maxCandidateOccurrences: 100 });
    expect(parseProcessingLimits({ ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 10_000 }).maxCandidateOccurrences).toBe(10_000);

    for (const invalid of [
      null,
      {},
      { ...DEFAULT_PROCESSING_LIMITS, maxTxtInputBytes: 2_097_153 },
      { ...DEFAULT_PROCESSING_LIMITS, maxTextUtf16CodeUnits: 200_001 },
      { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 99 },
      { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 10_001 },
      { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 5_000.5 },
      { ...DEFAULT_PROCESSING_LIMITS, unexpected: true },
    ]) {
      expect(() => parseProcessingLimits(invalid)).toThrow();
    }
  });

  it('stores only validated operational preferences outside canonical terminology storage', () => {
    const storage = new MemoryStorage();
    expect(readProcessingLimits(storage)).toEqual({ limits: DEFAULT_PROCESSING_LIMITS, status: 'defaults' });
    const reduced = { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 750 };
    writeProcessingLimits(reduced, storage);
    expect(storage.getItem(PROCESSING_LIMITS_STORAGE_KEY)).toBe(JSON.stringify(reduced));
    expect(readProcessingLimits(storage)).toEqual({ limits: reduced, status: 'saved' });
    storage.setItem(PROCESSING_LIMITS_STORAGE_KEY, '{bad json');
    expect(readProcessingLimits(storage)).toEqual({ limits: DEFAULT_PROCESSING_LIMITS, status: 'invalid' });
    storage.setItem(
      PROCESSING_LIMITS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 10_001 }),
    );
    expect(readProcessingLimits(storage)).toEqual({ limits: DEFAULT_PROCESSING_LIMITS, status: 'invalid' });
    expect(() => writeProcessingLimits({ ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 99 }, storage)).toThrow();
    expect(readProcessingLimits(storage).limits).toEqual(DEFAULT_PROCESSING_LIMITS);
  });

  it('counts unique half-open spans once and rejects the first additional distinct span', () => {
    const tracker = new OccurrenceLimitTracker(2);
    expect(tracker.add(0, 4)).toBe(true);
    expect(tracker.add(0, 4)).toBe(false);
    expect(tracker.add(0, 8)).toBe(true); // nested span remains distinct
    expect(() => tracker.add(10, 14)).toThrow(OccurrenceLimitExceededError);
    expect(tracker.count).toBe(2);
  });
});
