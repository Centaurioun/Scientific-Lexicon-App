import {
  parseLibrarySnapshot,
  type ExpressionRole,
  type LibrarySnapshot,
} from '@/domain/schema';

export const QUALITY_INSPECTOR_PAGE_SIZE = 50;

export function hasFormulaLeadingChar(text: string): boolean {
  if (!text) return false;
  const first = text[0];
  return first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r';
}

export type ConceptCoverageFlag =
  | 'EMPTY_CONCEPT'
  | 'MISSING_EN_EXPRESSION'
  | 'MISSING_TR_EXPRESSION'
  | 'NO_PREFERRED_EXPRESSION';

export type ExpressionAdvisoryFlag =
  | 'UNDETERMINED_LANGUAGE'
  | 'UNSPECIFIED_ROLE'
  | 'FORMULA_LEADING_TEXT'
  | 'EXTERIOR_OR_REPEATED_WHITESPACE'
  | 'REPEATED_PUNCTUATION';

export type QualityLanguageCategory = 'en' | 'tr' | 'shared' | 'undetermined';

export interface ExactSameConceptDuplicateItem {
  conceptId: string;
  text: string;
  language: QualityLanguageCategory;
  role: ExpressionRole;
  expressionIds: string[];
}

export interface HomonymGroupItem {
  surface: string;
  conceptIds: string[];
  expressionCount: number;
  isError: false;
}

export interface ConceptCoverageItem {
  conceptId: string;
  expressionCount: number;
  enCount: number;
  trCount: number;
  undeterminedCount: number;
  preferredCount: number;
  flags: ConceptCoverageFlag[];
}

export interface ExpressionAdvisoryItem {
  expressionId: string;
  conceptId: string;
  text: string;
  language: QualityLanguageCategory;
  role: ExpressionRole;
  flags: ExpressionAdvisoryFlag[];
}

export interface ProtectedExpressionItem {
  expressionId: string;
  conceptId: string;
  text: string;
  assertionId: string;
  actor: string;
  assertedAt: string;
}

export interface ReferentialIntegrityStatus {
  status: 'valid' | 'invalid-fail-closed';
  errorMessage: string | null;
}

export interface LibraryQualityReport {
  libraryRevision: number;
  totalConcepts: number;
  totalExpressions: number;
  referentialIntegrity: ReferentialIntegrityStatus;
  exactSameConceptDuplicates: ExactSameConceptDuplicateItem[];
  homonymGroups: HomonymGroupItem[];
  conceptCoverageItems: ConceptCoverageItem[];
  expressionAdvisoryItems: ExpressionAdvisoryItem[];
  protectedExpressionItems: ProtectedExpressionItem[];
}

export interface PaginatedQualityPage<T> {
  items: T[];
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

function getLanguageKey(
  lang: LibrarySnapshot['expressions'][number]['language']
): QualityLanguageCategory {
  if (lang.kind === 'shared') return 'shared';
  if (lang.kind === 'undetermined') return 'undetermined';
  if (lang.tag === 'tr') return 'tr';
  return 'en';
}

export function inspectLibraryQuality(rawSnapshot: unknown): LibraryQualityReport {
  let snapshot: LibrarySnapshot;
  try {
    snapshot = parseLibrarySnapshot(rawSnapshot);
  } catch (err) {
    const fallbackRev =
      typeof rawSnapshot === 'object' &&
      rawSnapshot !== null &&
      'libraryRevision' in rawSnapshot &&
      typeof (rawSnapshot as { libraryRevision?: unknown }).libraryRevision === 'number'
        ? (rawSnapshot as { libraryRevision: number }).libraryRevision
        : 0;
    return {
      libraryRevision: fallbackRev,
      totalConcepts: 0,
      totalExpressions: 0,
      referentialIntegrity: {
        status: 'invalid-fail-closed',
        errorMessage:
          err instanceof Error
            ? err.message
            : 'Canonical library snapshot referential integrity check failed.',
      },
      exactSameConceptDuplicates: [],
      homonymGroups: [],
      conceptCoverageItems: [],
      expressionAdvisoryItems: [],
      protectedExpressionItems: [],
    };
  }

  // 1. Group expressions by conceptId and index exact duplicates / homonyms
  const expressionsByConcept = new Map<string, LibrarySnapshot['expressions']>();
  for (const concept of snapshot.concepts) {
    expressionsByConcept.set(concept.id, []);
  }

  const sameConceptTupleMap = new Map<
    string,
    {
      conceptId: string;
      text: string;
      language: QualityLanguageCategory;
      role: ExpressionRole;
      expressionIds: string[];
    }
  >();

  const surfaceToConcepts = new Map<
    string,
    { conceptIds: Set<string>; expressionCount: number }
  >();

  const expressionById = new Map<string, LibrarySnapshot['expressions'][number]>();
  const expressionAdvisoryItems: ExpressionAdvisoryItem[] = [];

  for (const expr of snapshot.expressions) {
    expressionById.set(expr.id, expr);
    const list = expressionsByConcept.get(expr.conceptId);
    if (list) {
      list.push(expr);
    }

    const langKey = getLanguageKey(expr.language);
    const tupleKey = `${expr.conceptId}\u0000${langKey}\u0000${expr.role}\u0000${expr.text}`;
    const existingTuple = sameConceptTupleMap.get(tupleKey);
    if (existingTuple) {
      existingTuple.expressionIds.push(expr.id);
    } else {
      sameConceptTupleMap.set(tupleKey, {
        conceptId: expr.conceptId,
        text: expr.text,
        language: langKey,
        role: expr.role,
        expressionIds: [expr.id],
      });
    }

    const existingSurface = surfaceToConcepts.get(expr.text);
    if (existingSurface) {
      existingSurface.conceptIds.add(expr.conceptId);
      existingSurface.expressionCount += 1;
    } else {
      surfaceToConcepts.set(expr.text, {
        conceptIds: new Set([expr.conceptId]),
        expressionCount: 1,
      });
    }

    // Advisory checks on expression
    const advFlags: ExpressionAdvisoryFlag[] = [];
    if (langKey === 'undetermined') {
      advFlags.push('UNDETERMINED_LANGUAGE');
    }
    if (expr.role === 'unspecified') {
      advFlags.push('UNSPECIFIED_ROLE');
    }
    if (hasFormulaLeadingChar(expr.text)) {
      advFlags.push('FORMULA_LEADING_TEXT');
    }
    if (expr.text.trim() !== expr.text || /[ \t]{2,}/.test(expr.text)) {
      advFlags.push('EXTERIOR_OR_REPEATED_WHITESPACE');
    }
    if (/[.,;:!?]{2,}/.test(expr.text)) {
      advFlags.push('REPEATED_PUNCTUATION');
    }

    if (advFlags.length > 0) {
      expressionAdvisoryItems.push({
        expressionId: expr.id,
        conceptId: expr.conceptId,
        text: expr.text,
        language: langKey,
        role: expr.role,
        flags: advFlags,
      });
    }
  }

  const exactSameConceptDuplicates: ExactSameConceptDuplicateItem[] = [];
  for (const entry of sameConceptTupleMap.values()) {
    if (entry.expressionIds.length > 1) {
      exactSameConceptDuplicates.push({
        conceptId: entry.conceptId,
        text: entry.text,
        language: entry.language,
        role: entry.role,
        expressionIds: [...entry.expressionIds].sort(),
      });
    }
  }
  exactSameConceptDuplicates.sort(
    (a, b) =>
      a.conceptId.localeCompare(b.conceptId) ||
      a.text.localeCompare(b.text) ||
      a.language.localeCompare(b.language) ||
      a.role.localeCompare(b.role)
  );

  const homonymGroups: HomonymGroupItem[] = [];
  for (const [surface, group] of surfaceToConcepts.entries()) {
    if (group.conceptIds.size > 1) {
      homonymGroups.push({
        surface,
        conceptIds: [...group.conceptIds].sort(),
        expressionCount: group.expressionCount,
        isError: false,
      });
    }
  }
  homonymGroups.sort((a, b) => a.surface.localeCompare(b.surface));

  const conceptCoverageItems: ConceptCoverageItem[] = [];
  for (const concept of snapshot.concepts) {
    const exprs = expressionsByConcept.get(concept.id) ?? [];
    let enCount = 0;
    let trCount = 0;
    let undeterminedCount = 0;
    let preferredCount = 0;

    for (const expr of exprs) {
      const langKey = getLanguageKey(expr.language);
      if (langKey === 'en') enCount += 1;
      else if (langKey === 'tr') trCount += 1;
      else undeterminedCount += 1;

      if (expr.role === 'preferred') {
        preferredCount += 1;
      }
    }

    const flags: ConceptCoverageFlag[] = [];
    if (exprs.length === 0) {
      flags.push('EMPTY_CONCEPT');
    }
    if (enCount === 0) {
      flags.push('MISSING_EN_EXPRESSION');
    }
    if (trCount === 0) {
      flags.push('MISSING_TR_EXPRESSION');
    }
    if (preferredCount === 0) {
      flags.push('NO_PREFERRED_EXPRESSION');
    }

    if (flags.length > 0) {
      conceptCoverageItems.push({
        conceptId: concept.id,
        expressionCount: exprs.length,
        enCount,
        trCount,
        undeterminedCount,
        preferredCount,
        flags,
      });
    }
  }
  conceptCoverageItems.sort((a, b) => a.conceptId.localeCompare(b.conceptId));

  expressionAdvisoryItems.sort((a, b) => a.expressionId.localeCompare(b.expressionId));

  const protectedExpressionItems: ProtectedExpressionItem[] = [];
  for (const assertion of snapshot.assertions) {
    if (assertion.kind === 'user-confirmed' && assertion.field === 'text') {
      const expr = expressionById.get(assertion.expressionId);
      if (expr) {
        protectedExpressionItems.push({
          expressionId: expr.id,
          conceptId: expr.conceptId,
          text: expr.text,
          assertionId: assertion.id,
          actor: assertion.actor,
          assertedAt: assertion.assertedAt,
        });
      }
    }
  }
  protectedExpressionItems.sort((a, b) => a.expressionId.localeCompare(b.expressionId));

  return {
    libraryRevision: snapshot.libraryRevision,
    totalConcepts: snapshot.concepts.length,
    totalExpressions: snapshot.expressions.length,
    referentialIntegrity: {
      status: 'valid',
      errorMessage: null,
    },
    exactSameConceptDuplicates,
    homonymGroups,
    conceptCoverageItems,
    expressionAdvisoryItems,
    protectedExpressionItems,
  };
}

export function paginateQualityItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number = QUALITY_INSPECTOR_PAGE_SIZE
): PaginatedQualityPage<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  return {
    items: items.slice(startIndex, startIndex + safePageSize),
    currentPage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
  };
}
