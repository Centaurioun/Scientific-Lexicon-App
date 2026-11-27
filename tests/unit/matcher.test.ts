import { describe, expect, it } from 'vitest';
import {
  AhoCorasickRegisteredMatcher,
  RevisionCachedRegisteredMatcher,
  SimpleOracleRegisteredMatcher,
} from '@/adapters/matching/registered-matcher';
import type { Expression } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';

function expr(id: string, conceptId: string, text: string, tag: 'en' | 'tr' = 'en'): Expression {
  return {
    id,
    conceptId,
    revision: 0,
    text,
    language: { kind: 'language', tag },
    role: 'preferred',
    createdAt: TS,
    updatedAt: TS,
  };
}

describe('scientific registered term matcher (B1)', () => {
  const expressions: Expression[] = [
    expr('il1', 'c-il1', 'IL-1'),
    expr('il11', 'c-il11', 'IL-11'),
    expr('cd4plus', 'c-cd4', 'CD4+'),
    expr('pd-1', 'c-pd-depth', 'PD'),
    expr('pd-2', 'c-pd-disease', 'PD'),
    expr('pdl', 'c-pdl', 'periodontal ligament'),
    expr('pdlsc', 'c-pdlsc', 'periodontal ligament stem cells'),
    expr('tnfa', 'c-tnfa', 'TNF-α'),
    expr('p53-lower', 'c-p53-gene', 'p53'),
    expr('tr-i-dot', 'c-tr1', 'İltihap', 'tr'),
    expr('tr-dotless', 'c-tr2', 'ısı', 'tr'),
    expr('combining', 'c-comb', 'cafe\u0301'),
  ];

  const aho = new AhoCorasickRegisteredMatcher();
  const oracle = new SimpleOracleRegisteredMatcher();

  async function scanBoth(text: string, dict: Expression[] = expressions) {
    const ahoOut = await aho.match(text, dict);
    const oracleOut = await oracle.match(text, dict);
    expect(ahoOut).toEqual(oracleOut);
    return ahoOut;
  }

  it('distinguishes IL-1 from IL-11 and prevents CD4+ inside CD4++', async () => {
    const ilMatches = await scanBoth('IL-11 IL-1');
    expect(ilMatches.flatMap((m) => m.expressionIds)).toEqual(['il11', 'il1']);

    const cd4Matches = await scanBoth('CD4++ cells vs CD4+ cells');
    expect(cd4Matches).toHaveLength(1);
    expect(cd4Matches[0].surface).toBe('CD4+');
    expect(cd4Matches[0].start).toBe(15);
    expect(cd4Matches[0].end).toBe(19);
  });

  it('keeps PD ambiguous across two concepts with unresolved resolvedConceptId', async () => {
    const matches = await scanBoth('Measured PD baseline.');
    expect(matches).toHaveLength(1);
    expect(matches[0].surface).toBe('PD');
    expect(matches[0].expressionIds).toEqual(['pd-1', 'pd-2']);
    expect(matches[0].conceptIds).toEqual(['c-pd-depth', 'c-pd-disease']);
    expect(matches[0].state).toBe('ambiguous');
    expect(matches[0].resolvedConceptId).toBeNull();
  });

  it('retains nested spans (periodontal ligament inside periodontal ligament stem cells)', async () => {
    const text = 'Human periodontal ligament stem cells proliferate.';
    const matches = await scanBoth(text);
    expect(matches.map((m) => m.surface)).toEqual([
      'periodontal ligament stem cells',
      'periodontal ligament',
    ]);
    for (const m of matches) {
      expect(text.slice(m.start, m.end)).toBe(m.surface);
    }
  });

  it('rejects Greek-adjacent αTNF-α and TNF-αβ, handles emoji UTF-16 offset start=3, case sensitivity p53 != P53, Turkish İ/ı, combining marks, and provisional hyphen x-TNF-α', async () => {
    expect(await scanBoth('αTNF-α TNF-αβ')).toEqual([]);

    const emojiText = '🧪 TNF-α';
    const emojiMatches = await scanBoth(emojiText);
    expect(emojiMatches).toHaveLength(1);
    expect(emojiMatches[0].start).toBe(3);
    expect(emojiMatches[0].end).toBe(8);
    expect(emojiText.slice(emojiMatches[0].start, emojiMatches[0].end)).toBe('TNF-α');

    expect(await scanBoth('P53')).toEqual([]);
    const p53Matches = await scanBoth('p53 and P53');
    expect(p53Matches).toHaveLength(1);
    expect(p53Matches[0].surface).toBe('p53');

    // Turkish İ/ı and combining mark exact matching
    expect((await scanBoth('İltihap ve ısı')).map((m) => m.surface)).toEqual(['İltihap', 'ısı']);
    expect(await scanBoth('iltihap ve isi')).toEqual([]);
    expect((await scanBoth('cafe\u0301 test')).map((m) => m.surface)).toEqual(['cafe\u0301']);
    expect(await scanBoth('caf\u00e9 test')).toEqual([]);
    // Combining mark directly following term disallows match
    expect(await scanBoth('TNF-α\u0301')).toEqual([]);

    // Provisional hyphen attachment: matches candidate but leaves identity unresolved
    const hyphenMatches = await scanBoth('x-TNF-α expression');
    expect(hyphenMatches).toHaveLength(1);
    expect(hyphenMatches[0].surface).toBe('TNF-α');
    expect(hyphenMatches[0].state).toBe('possible-new-form');
    expect(hyphenMatches[0].resolvedConceptId).toBeNull();
  });

  it('rejects empty patterns and invalidates cached index when library revision changes', async () => {
    await expect(
      aho.match('TNF-α', [expr('bad', 'c-bad', '')]),
    ).rejects.toThrow(/empty/i);

    const cached = new RevisionCachedRegisteredMatcher();
    const rev1 = await cached.matchForRevision(1, 'IL-1 and TNF-α', [expr('il1', 'c1', 'IL-1')]);
    expect(rev1.map((m) => m.surface)).toEqual(['IL-1']);

    // Revision bumped -> stale cache must NOT be reused
    const rev2 = await cached.matchForRevision(2, 'IL-1 and TNF-α', [
      expr('il1', 'c1', 'IL-1'),
      expr('tnfa', 'c2', 'TNF-α'),
    ]);
    expect(rev2.map((m) => m.surface)).toEqual(['IL-1', 'TNF-α']);
  });
});
