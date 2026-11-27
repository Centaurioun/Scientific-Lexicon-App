import {
  DEFAULT_PROCESSING_LIMITS,
  parseProcessingLimits,
  type ProcessingLimits,
} from '@/domain/processing-limits';

export const PROCESSING_LIMITS_STORAGE_KEY = 'termforge:processing-limits:v1';

export interface ProcessingLimitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProcessingLimitReadResult {
  limits: ProcessingLimits;
  status: 'defaults' | 'saved' | 'invalid' | 'unavailable';
}

function currentStorage(): ProcessingLimitStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readProcessingLimits(
  storage: ProcessingLimitStorage | null = currentStorage(),
): ProcessingLimitReadResult {
  if (!storage) return { limits: DEFAULT_PROCESSING_LIMITS, status: 'unavailable' };
  try {
    const raw = storage.getItem(PROCESSING_LIMITS_STORAGE_KEY);
    if (raw === null) return { limits: DEFAULT_PROCESSING_LIMITS, status: 'defaults' };
    return { limits: parseProcessingLimits(JSON.parse(raw)), status: 'saved' };
  } catch {
    return { limits: DEFAULT_PROCESSING_LIMITS, status: 'invalid' };
  }
}

export function writeProcessingLimits(
  input: unknown,
  storage: ProcessingLimitStorage | null = currentStorage(),
): ProcessingLimits {
  const limits = parseProcessingLimits(input);
  if (!storage) throw new Error('Browser storage is unavailable; processing limits were not saved.');
  storage.setItem(PROCESSING_LIMITS_STORAGE_KEY, JSON.stringify(limits));
  return limits;
}
