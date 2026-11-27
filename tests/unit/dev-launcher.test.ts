import { describe, expect, it } from 'vitest';
import { normalizeNextDevArgs } from '../../scripts/dev.mjs';

describe('dev launcher argument normalization', () => {
  it('defaults to binding 0.0.0.0 when no host flag is provided', () => {
    expect(normalizeNextDevArgs([])).toEqual(['--hostname', '0.0.0.0']);
    expect(normalizeNextDevArgs(['--port', '3100'])).toEqual([
      '--hostname',
      '0.0.0.0',
      '--port',
      '3100',
    ]);
  });

  it('translates AI Studio --host flag to Next.js --hostname', () => {
    expect(normalizeNextDevArgs(['--port', '3000', '--host', '0.0.0.0'])).toEqual([
      '--port',
      '3000',
      '--hostname',
      '0.0.0.0',
    ]);
    expect(normalizeNextDevArgs(['--port=3000', '--host=127.0.0.1'])).toEqual([
      '--port=3000',
      '--hostname=127.0.0.1',
    ]);
    expect(normalizeNextDevArgs(['--host', '--port', '3000'])).toEqual([
      '--hostname',
      '0.0.0.0',
      '--port',
      '3000',
    ]);
  });

  it('preserves explicit --hostname and -H flags without duplicating host binding', () => {
    expect(normalizeNextDevArgs(['--hostname', '127.0.0.1', '--port', '3100'])).toEqual([
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ]);
    expect(normalizeNextDevArgs(['-H', '127.0.0.1'])).toEqual(['-H', '127.0.0.1']);
  });

  it('strips a stray leading -- separator so forwarded flags still parse', () => {
    expect(normalizeNextDevArgs(['--', '--port', '3100', '--host', '127.0.0.1'])).toEqual([
      '--port',
      '3100',
      '--hostname',
      '127.0.0.1',
    ]);
  });
});
