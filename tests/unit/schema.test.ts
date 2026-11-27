import { describe, expect, it } from 'vitest';
import {
  createEmptySnapshot,
  parseConcept,
  parseExpression,
  parseLibrarySnapshot,
  parseProvenance,
  parseVerificationAssertion,
  type Expression,
  type LibrarySnapshot,
} from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';

describe('canonical record schemas (A2)', () => {
  const validTr: Expression = {
    id: 'expr-tr-1',
    conceptId: 'concept-1',
    revision: 0,
    text: 'tümör nekroz faktörü alfa',
    language: { kind: 'language', tag: 'tr' },
    role: 'preferred',
    createdAt: TS,
    updatedAt: TS,
  };

  it('parses valid Turkish, English, regional, shared, and undetermined expressions while preserving Unicode and case', () => {
    expect(parseExpression(validTr).language).toEqual({ kind: 'language', tag: 'tr' });

    const enGb = parseExpression({
      ...validTr,
      id: 'expr-en-gb',
      text: 'TNF-α',
      language: { kind: 'language', tag: 'en-GB' },
      role: 'abbreviation',
    });
    expect(enGb.text).toBe('TNF-α');
    expect(enGb.language).toEqual({ kind: 'language', tag: 'en-GB' });

    const shared = parseExpression({
      ...validTr,
      id: 'expr-shared',
      text: '2,4-dinitrophenol',
      language: { kind: 'shared' },
      role: 'unspecified',
    });
    expect(shared.language).toEqual({ kind: 'shared' });
    expect(shared.text).toBe('2,4-dinitrophenol');

    const undet = parseExpression({
      ...validTr,
      id: 'expr-undet',
      text: 'p53',
      language: { kind: 'undetermined' },
      role: 'alternative',
    });
    expect(undet.language).toEqual({ kind: 'undetermined' });
    expect(undet.text).toBe('p53');
  });

  it('rejects whitespace-only text, unsupported language code, unknown keys, negative revision, and non-UTC timestamps', () => {
    expect(() => parseExpression({ ...validTr, text: '   \t\n ' })).toThrow();
    expect(() => parseExpression({ ...validTr, text: '' })).toThrow();
    expect(() =>
      parseExpression({
        ...validTr,
        language: { kind: 'language', tag: 'de' },
      }),
    ).toThrow();
    expect(() =>
      parseExpression({
        ...validTr,
        extraKey: 'not-allowed',
      }),
    ).toThrow();
    expect(() => parseExpression({ ...validTr, revision: -1 })).toThrow();
    expect(() => parseExpression({ ...validTr, revision: 1.5 })).toThrow();
    expect(() => parseExpression({ ...validTr, createdAt: '2026-11-26' })).toThrow();
    expect(() =>
      parseConcept({
        id: 'c1',
        revision: -1,
        createdAt: TS,
        updatedAt: TS,
      }),
    ).toThrow();
  });

  it('validates empty snapshot and allows partial bilingual records and identical PD expressions under distinct concepts', () => {
    const empty = createEmptySnapshot();
    expect(parseLibrarySnapshot(empty)).toEqual(empty);

    const snapshot: LibrarySnapshot = {
      ...empty,
      libraryRevision: 2,
      concepts: [
        { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
        { id: 'c2', revision: 0, createdAt: TS, updatedAt: TS },
      ],
      expressions: [
        {
          id: 'e1',
          conceptId: 'c1',
          revision: 0,
          text: 'PD',
          language: { kind: 'language', tag: 'en' },
          role: 'abbreviation',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e2',
          conceptId: 'c2',
          revision: 0,
          text: 'PD',
          language: { kind: 'language', tag: 'en' },
          role: 'abbreviation',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
      provenance: [
        { id: 'p1', expressionId: 'e1', kind: 'manual', createdAt: TS, source: null },
        { id: 'p2', expressionId: 'e2', kind: 'manual', createdAt: TS, source: null },
      ],
    };

    const parsed = parseLibrarySnapshot(snapshot);
    expect(parsed.concepts).toHaveLength(2);
    expect(parsed.expressions.map((e) => e.text)).toEqual(['PD', 'PD']);
  });

  it('rejects a concept with no expressions and rejects an orphan expression', () => {
    const empty = createEmptySnapshot();

    expect(() =>
      parseLibrarySnapshot({
        ...empty,
        libraryRevision: 1,
        concepts: [{ id: 'c1', revision: 0, createdAt: TS, updatedAt: TS }],
      }),
    ).toThrow(/concept.*expression/i);

    expect(() =>
      parseLibrarySnapshot({
        ...empty,
        libraryRevision: 1,
        expressions: [
          {
            id: 'e-orphan',
            conceptId: 'missing-concept',
            revision: 0,
            text: 'TNF-α',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
        ],
      }),
    ).toThrow(/orphan|concept/i);
  });

  it('validates verification assertions, provenance, and retained document span integrity', () => {
    const assertion = parseVerificationAssertion({
      id: 'a1',
      expressionId: 'e1',
      field: 'text',
      value: 'TNF-α',
      recordRevision: 0,
      kind: 'user-confirmed',
      actor: 'local-user',
      assertedAt: TS,
    });
    expect(assertion.kind).toBe('user-confirmed');

    const prov = parseProvenance({
      id: 'p1',
      expressionId: 'e1',
      kind: 'reviewed-candidate',
      createdAt: TS,
      source: null,
    });
    expect(prov.source).toBeNull();

    // Non-null provenance source pointing to missing document must fail snapshot validation
    expect(() =>
      parseLibrarySnapshot({
        ...createEmptySnapshot(),
        libraryRevision: 1,
        concepts: [{ id: 'c1', revision: 0, createdAt: TS, updatedAt: TS }],
        expressions: [
          {
            id: 'e1',
            conceptId: 'c1',
            revision: 0,
            text: 'TNF-α',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
        ],
        provenance: [
          {
            id: 'p1',
            expressionId: 'e1',
            kind: 'reviewed-candidate',
            createdAt: TS,
            source: { documentId: 'missing-doc', runId: 'missing-run', start: 0, end: 5 },
          },
        ],
      }),
    ).toThrow(/document|source/i);
  });
});
