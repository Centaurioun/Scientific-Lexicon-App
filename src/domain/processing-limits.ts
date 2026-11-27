import { z } from 'zod';

export const MAX_TXT_INPUT_BYTES = 2_097_152;
export const MAX_TEXT_UTF16_CODE_UNITS = 200_000;
export const MIN_CANDIDATE_OCCURRENCES = 100;
export const DEFAULT_CANDIDATE_OCCURRENCES = 5_000;
export const MAX_CANDIDATE_OCCURRENCES = 10_000;
export const MAX_BACKUP_FILE_BYTES = 16_777_216;

const ProcessingLimitsSchema = z
  .object({
    maxTxtInputBytes: z.number().int().min(1).max(MAX_TXT_INPUT_BYTES),
    maxTextUtf16CodeUnits: z.number().int().min(1).max(MAX_TEXT_UTF16_CODE_UNITS),
    maxCandidateOccurrences: z
      .number()
      .int()
      .min(MIN_CANDIDATE_OCCURRENCES)
      .max(MAX_CANDIDATE_OCCURRENCES),
  })
  .strict();

export type ProcessingLimits = z.infer<typeof ProcessingLimitsSchema>;

export const DEFAULT_PROCESSING_LIMITS: ProcessingLimits = Object.freeze({
  maxTxtInputBytes: MAX_TXT_INPUT_BYTES,
  maxTextUtf16CodeUnits: MAX_TEXT_UTF16_CODE_UNITS,
  maxCandidateOccurrences: DEFAULT_CANDIDATE_OCCURRENCES,
});

export function parseProcessingLimits(input: unknown): ProcessingLimits {
  return ProcessingLimitsSchema.parse(input);
}

export class OccurrenceLimitExceededError extends Error {
  readonly limit: number;
  readonly observedAtLeast: number;

  constructor(limit: number) {
    super(
      `Analysis exceeded the configured limit of ${limit.toLocaleString('en-US')} distinct occurrence spans. No partial extraction results are available. Reduce the source or raise the limit within the supported range, then analyze again.`,
    );
    this.name = 'OccurrenceLimitExceededError';
    this.limit = limit;
    this.observedAtLeast = limit + 1;
  }
}

/** Counts unique half-open UTF-16 spans across matcher and candidate generation. */
export class OccurrenceLimitTracker {
  private readonly spans = new Set<string>();

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CANDIDATE_OCCURRENCES) {
      throw new RangeError(`Occurrence tracker limit must be between 1 and ${MAX_CANDIDATE_OCCURRENCES}.`);
    }
  }

  get count(): number {
    return this.spans.size;
  }

  add(start: number, end: number): boolean {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      throw new RangeError('Occurrence span must be a non-empty nonnegative half-open range.');
    }
    const key = `${start}:${end}`;
    if (this.spans.has(key)) return false;
    if (this.spans.size >= this.limit) {
      throw new OccurrenceLimitExceededError(this.limit);
    }
    this.spans.add(key);
    return true;
  }
}
