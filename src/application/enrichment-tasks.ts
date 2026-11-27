import { deepFreeze } from '@/domain/changes';
import {
  compareCodeUnits,
  isExpressionProtected,
  languageMatchesFilter,
  parseLibrarySnapshot,
  type ExpressionRole,
  type LanguageUse,
  type LibrarySnapshot,
} from '@/domain/schema';

export const ENRICHMENT_TASK_MAX_PAGE_SIZE = 50 as const;
export const ENRICHMENT_TASK_MAX_TARGETS = 50 as const;

export type EnrichmentTaskKind =
  | 'missing-en'
  | 'missing-tr'
  | 'unspecified-role'
  | 'undetermined-language'
  | 'candidate-review';

export type EnrichmentTaskFilterKind = 'all' | EnrichmentTaskKind;

export interface ScopedConceptExpression {
  readonly id: string;
  readonly revision: number;
  readonly text: string;
  readonly language: LanguageUse;
  readonly role: ExpressionRole;
  readonly protected: boolean;
}

export interface EnrichmentTaskCandidate {
  readonly conceptId: string;
  readonly conceptRevision: number;
  readonly missingLanguages: readonly ('en' | 'tr')[];
  readonly eligibleKinds: readonly EnrichmentTaskKind[];
  readonly expressions: readonly ScopedConceptExpression[];
  readonly hasProtectedExpression: boolean;
  readonly homonymSiblingCount: number;
  readonly uncertaintyNotice: string;
}

export interface EnrichmentTaskDiscoveryOptions {
  readonly taskKind?: EnrichmentTaskFilterKind;
  readonly query?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface EnrichmentTaskDiscoveryPage {
  readonly baseLibraryRevision: number;
  readonly taskKind: EnrichmentTaskFilterKind;
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly items: readonly EnrichmentTaskCandidate[];
}

export interface TargetSelectionRequestItem {
  readonly conceptId: string;
  readonly expectedConceptRevision: number;
}

export interface SelectedEnrichmentTarget {
  readonly conceptId: string;
  readonly conceptRevision: number;
  readonly expressions: readonly ScopedConceptExpression[];
}

export interface ValidatedEnrichmentSelection {
  readonly baseLibraryRevision: number;
  readonly taskKind: EnrichmentTaskKind;
  readonly targets: readonly SelectedEnrichmentTarget[];
}

const ABSENCE_UNCERTAINTY_NOTICE =
  'Missing EN/TR forms, unspecified roles, or unasserted candidates indicate open review scope—absence is not an error, and no translation or scientific certainty is inferred.';

/**
 * Pure deterministic read-only missing-field & review-task discovery (WP04 F2).
 * Never mutates library state, never exports retained document text, and caps pageSize <= 50.
 */
export function discoverMissingFieldTasks(
  snapshot: LibrarySnapshot,
  options: EnrichmentTaskDiscoveryOptions = {},
): EnrichmentTaskDiscoveryPage {
  const validSnapshot = parseLibrarySnapshot(snapshot);
  const taskKind: EnrichmentTaskFilterKind = options.taskKind ?? 'all';
  const query = options.query ?? '';
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;

  if (!Number.isInteger(page) || page < 1) {
    throw new Error('Invalid pagination page number: expected positive integer >= 1.');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ENRICHMENT_TASK_MAX_PAGE_SIZE) {
    throw new Error(
      `Invalid pageSize ${pageSize}: must be between 1 and ${ENRICHMENT_TASK_MAX_PAGE_SIZE}.`,
    );
  }

  // Build bounded read-only indices
  const exprsByConcept = new Map<string, ScopedConceptExpression[]>();
  const surfaceConceptSets = new Map<string, Set<string>>();
  const provenanceKindByExprId = new Map<string, string>(
    validSnapshot.provenance.map((p) => [p.expressionId, p.kind]),
  );

  for (const expr of validSnapshot.expressions) {
    const protectedFlag = isExpressionProtected(expr, validSnapshot.assertions);
    const list = exprsByConcept.get(expr.conceptId) ?? [];
    list.push({
      id: expr.id,
      revision: expr.revision,
      text: expr.text,
      language: expr.language,
      role: expr.role,
      protected: protectedFlag,
    });
    exprsByConcept.set(expr.conceptId, list);

    let conceptSet = surfaceConceptSets.get(expr.text);
    if (!conceptSet) {
      conceptSet = new Set();
      surfaceConceptSets.set(expr.text, conceptSet);
    }
    conceptSet.add(expr.conceptId);
  }

  const allCandidates: EnrichmentTaskCandidate[] = [];
  const sortedConcepts = [...validSnapshot.concepts].sort((a, b) => compareCodeUnits(a.id, b.id));

  for (const concept of sortedConcepts) {
    const expressions = [...(exprsByConcept.get(concept.id) ?? [])].sort((a, b) =>
      compareCodeUnits(a.id, b.id),
    );
    const hasEn = expressions.some((e) => languageMatchesFilter(e.language, 'en'));
    const hasTr = expressions.some((e) => languageMatchesFilter(e.language, 'tr'));
    const hasUnspecifiedRole = expressions.some((e) => e.role === 'unspecified');
    const hasUndeterminedLang = expressions.some((e) => e.language.kind === 'undetermined');
    const hasReviewedCandidate = expressions.some(
      (e) => provenanceKindByExprId.get(e.id) === 'reviewed-candidate',
    );
    const hasProtectedExpression = expressions.some((e) => e.protected);
    const needsCandidateReview = hasReviewedCandidate || !hasProtectedExpression;

    const eligibleKinds: EnrichmentTaskKind[] = [];
    const missingLanguages: ('en' | 'tr')[] = [];
    if (!hasEn) {
      missingLanguages.push('en');
      eligibleKinds.push('missing-en');
    }
    if (!hasTr) {
      missingLanguages.push('tr');
      eligibleKinds.push('missing-tr');
    }
    if (hasUnspecifiedRole) {
      eligibleKinds.push('unspecified-role');
    }
    if (hasUndeterminedLang) {
      eligibleKinds.push('undetermined-language');
    }
    if (needsCandidateReview) {
      eligibleKinds.push('candidate-review');
    }

    if (eligibleKinds.length === 0) {
      continue;
    }

    if (taskKind !== 'all' && !eligibleKinds.includes(taskKind)) {
      continue;
    }

    if (query.length > 0) {
      const matchedQuery =
        concept.id.includes(query) || expressions.some((e) => e.text.includes(query));
      if (!matchedQuery) {
        continue;
      }
    }

    const siblingConcepts = new Set<string>();
    for (const expr of expressions) {
      const owners = surfaceConceptSets.get(expr.text);
      if (owners) {
        for (const ownerId of owners) {
          if (ownerId !== concept.id) {
            siblingConcepts.add(ownerId);
          }
        }
      }
    }

    allCandidates.push({
      conceptId: concept.id,
      conceptRevision: concept.revision,
      missingLanguages,
      eligibleKinds,
      expressions,
      hasProtectedExpression,
      homonymSiblingCount: siblingConcepts.size,
      uncertaintyNotice: ABSENCE_UNCERTAINTY_NOTICE,
    });
  }

  const totalItems = allCandidates.length;
  const totalPages = totalItems === 0 ? 1 : Math.ceil(totalItems / pageSize);
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const items = allCandidates.slice(start, start + pageSize);

  return deepFreeze({
    baseLibraryRevision: validSnapshot.libraryRevision,
    taskKind,
    page: clampedPage,
    pageSize,
    totalItems,
    totalPages,
    items,
  });
}

/**
 * Validates and binds explicit target concept selections (<= 50) against exact current
 * concept IDs and concept revisions. Fails closed on empty, duplicate, over-limit,
 * missing, or stale selections.
 */
export function selectEnrichmentTargets(
  snapshot: LibrarySnapshot,
  requestedTargets: readonly TargetSelectionRequestItem[],
  taskKind: EnrichmentTaskKind,
): ValidatedEnrichmentSelection {
  const validSnapshot = parseLibrarySnapshot(snapshot);
  if (requestedTargets.length === 0) {
    throw new Error('At least one target concept must be selected.');
  }
  if (requestedTargets.length > ENRICHMENT_TASK_MAX_TARGETS) {
    throw new Error(
      `Selection exceeds maximum ${ENRICHMENT_TASK_MAX_TARGETS} targets per task (received ${requestedTargets.length}).`,
    );
  }

  const conceptsById = new Map(validSnapshot.concepts.map((c) => [c.id, c]));
  const exprsByConcept = new Map<string, ScopedConceptExpression[]>();
  for (const expr of validSnapshot.expressions) {
    const protectedFlag = isExpressionProtected(expr, validSnapshot.assertions);
    const list = exprsByConcept.get(expr.conceptId) ?? [];
    list.push({
      id: expr.id,
      revision: expr.revision,
      text: expr.text,
      language: expr.language,
      role: expr.role,
      protected: protectedFlag,
    });
    exprsByConcept.set(expr.conceptId, list);
  }

  const seenIds = new Set<string>();
  const validatedTargets: SelectedEnrichmentTarget[] = [];

  for (const item of requestedTargets) {
    if (!item.conceptId || item.conceptId.trim().length === 0) {
      throw new Error('Target selection contains an empty conceptId.');
    }
    if (seenIds.has(item.conceptId)) {
      throw new Error(`Duplicate target conceptId selected: ${item.conceptId}.`);
    }
    seenIds.add(item.conceptId);

    const concept = conceptsById.get(item.conceptId);
    if (!concept) {
      throw new Error(`Selected target concept ${item.conceptId} is missing from the current library snapshot.`);
    }
    if (!Number.isInteger(item.expectedConceptRevision) || item.expectedConceptRevision < 0) {
      throw new Error(`Invalid expected concept revision for ${item.conceptId}.`);
    }
    if (concept.revision !== item.expectedConceptRevision) {
      throw new Error(
        `Stale selection for concept ${item.conceptId}: expected revision ${item.expectedConceptRevision}, current is ${concept.revision}.`,
      );
    }

    const expressions = [...(exprsByConcept.get(concept.id) ?? [])].sort((a, b) =>
      compareCodeUnits(a.id, b.id),
    );
    validatedTargets.push({
      conceptId: concept.id,
      conceptRevision: concept.revision,
      expressions,
    });
  }

  validatedTargets.sort((a, b) => compareCodeUnits(a.conceptId, b.conceptId));

  return deepFreeze({
    baseLibraryRevision: validSnapshot.libraryRevision,
    taskKind,
    targets: validatedTargets,
  });
}
