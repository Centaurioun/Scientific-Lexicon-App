import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('starter runtime tooling', () => {
  it('loads the single selected runtime schema authority', () => {
    const readiness = z.object({ status: z.literal('ready') }).strict();
    expect(readiness.safeParse({ status: 'ready' }).success).toBe(true);
    expect(readiness.safeParse({ status: 'ready', unexpected: true }).success).toBe(false);
  });
});
