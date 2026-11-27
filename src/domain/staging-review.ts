import { deepFreeze } from './changes';
import {
  compareCodeUnits,
  formatLanguageUse,
  isExpressionProtected,
  type Expression,
  type LanguageUse,
  type LibrarySnapshot,
} from './schema';
import type { StagedMappedRow, StagedMappedTable } from './staging-mapping';

export type StagedRowClassification =
  | 'invalid-row'
  | 'new-surface'
  | 'exact-single-concept-match'
  | 'ambiguous-multi-concept-homonym';

export type StagedConflictFlag =
  | 'EXACT_SAME_CONCEPT_DUPLICATE'
  | 'AMBIGUOUS_EXISTING_HOMONYM'
  | 'PROTECTED_EXISTING_MATCH'
  | 'INTRA_STAGE_DUPLICATE'
  | 'INTRA_STAGE_CROSS_GROUP_HOMONYM'
  | 'GROUP_TARGET_CONFLICT'
  | 'MISSING_GROUP_ROOT_CONCEPT'
  | 'INVALID_TARGET_CONCEPT'
  | 'ADVISORY_CASE_OR_WHITESPACE_SIMILARITY';

export const CONFLICT_FLAG_ORDER: readonly StagedConflictFlag[] = [
  'INVALID_TARGET_CONCEPT',
  'GROUP_TARGET_CONFLICT',
  'MISSING_GROUP_ROOT_CONCEPT',
  'EXACT_SAME_CONCEPT_DUPLICATE',
  'AMBIGUOUS_EXISTING_HOMONYM',
  'PROTECTED_EXISTING_MATCH',
  'INTRA_STAGE_DUPLICATE',
  'INTRA_STAGE_CROSS_GROUP_HOMONYM',
  'ADVISORY_CASE_OR_WHITESPACE_SIMILARITY',
];

export type StagedRowUserDecision =
  | { readonly action: 'unresolved' }
  | { readonly action: 'skip' }
  | { readonly action: 'create-new-concept' }
  | { readonly action: 'link-existing-concept'; readonly targetConceptId: string }
  | { readonly action: 'link-staged-group'; readonly groupKey: string };

export interface ReviewedStagedRow {
  readonly row: StagedMappedRow;
  readonly classification: StagedRowClassification;
  readonly matchingExistingConceptIds: readonly string[];
  readonly matchingExistingExpressions: readonly Expression[];
  readonly matchesProtectedExistingExpression: boolean;
  readonly advisorySimilarConceptIds: readonly string[];
  readonly conflictFlags: readonly StagedConflictFlag[];
  readonly decision: StagedRowUserDecision;
  readonly hasBlockingConflict: boolean;
  readonly isActionableOperation: boolean;
}

export interface StagedReviewCounts {
  readonly totalRows: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly createConceptCount: number;
  readonly addExpressionToExistingCount: number;
  readonly addExpressionToStagedGroupCount: number;
  readonly skippedRowCount: number;
  readonly unresolvedRowCount: number;
  readonly blockingConflictRowCount: number;
}

export interface StagedReviewEvaluation {
  readonly table: StagedMappedTable;
  readonly baseLibraryRevision: number;
  readonly rows: readonly ReviewedStagedRow[];
  readonly counts: StagedReviewCounts;
  readonly canBuildProposal: boolean;
  readonly blockingReasons: readonly string[];
}

function makeAdvisoryFoldKey(text: string, lang: LanguageUse | null): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (lang && lang.kind === 'language' && lang.tag === 'tr') {
    return collapsed.toLocaleLowerCase('tr');
  }
  return collapsed.toLowerCase();
}

function sortUniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort(compareCodeUnits);
}

function sortConflictFlags(flags: Iterable<StagedConflictFlag>): StagedConflictFlag[] {
  const set = new Set(flags);
  return CONFLICT_FLAG_ORDER.filter((flag) => set.has(flag));
}

/**
 * Pure indexed duplicate/conflict and grouping review evaluation (WP03 E4).
 *
 * Uses O(N + M) hash indexes over `snapshot.expressions` and `table.rows` (never unbounded
 * O(N^2) pairwise Levenshtein/fuzzy scans) to classify exact surface matches, homonyms,
 * protected assertions, intra-stage duplicates, group target consistency, and advisory
 * case/whitespace similarity.
 */
export function evaluateStagingReview(
  table: StagedMappedTable,
  snapshot: LibrarySnapshot,
  userDecisions: Readonly<Record<string, StagedRowUserDecision>>,
): StagedReviewEvaluation {
  const conceptsById = new Map(snapshot.concepts.map((c) => [c.id, c]));

  // 1. Index existing expressions by exact surface text AND advisory folded key
  const existingBySurface = new Map<string, Expression[]>();
  const existingConceptsByFoldKey = new Map<string, Set<string>>();

  for (const expr of snapshot.expressions) {
    const list = existingBySurface.get(expr.text);
    if (list) {
      list.push(expr);
    } else {
      existingBySurface.set(expr.text, [expr]);
    }

    const foldKey = makeAdvisoryFoldKey(expr.text, expr.language);
    let foldSet = existingConceptsByFoldKey.get(foldKey);
    if (!foldSet) {
      foldSet = new Set<string>();
      existingConceptsByFoldKey.set(foldKey, foldSet);
    }
    foldSet.add(expr.conceptId);
  }

  // 2. Index staged rows by (surface, lang, role, group) for intra-stage duplicates
  // and by surface -> set of group headers for cross-group homonyms
  const stageSignatureCounts = new Map<string, number>();
  const stageGroupsBySurface = new Map<string, Set<string>>();

  for (const row of table.rows) {
    if (!row.isValidForPlanning || !row.stagedLanguage || !row.stagedRole) continue;
    const langStr = formatLanguageUse(row.stagedLanguage);
    const grpKey = row.groupKey ?? `__UNGROUPED_${row.rowId}`;
    const sig = `${grpKey}\u0000${row.stagedTermText}\u0000${langStr}\u0000${row.stagedRole}`;
    stageSignatureCounts.set(sig, (stageSignatureCounts.get(sig) ?? 0) + 1);

    let grpSet = stageGroupsBySurface.get(row.stagedTermText);
    if (!grpSet) {
      grpSet = new Set<string>();
      stageGroupsBySurface.set(row.stagedTermText, grpSet);
    }
    grpSet.add(grpKey);
  }

  // 3. Determine effective decisions and inspect group target consistency
  // Default policy: never silently merge or skip. If user has not supplied an explicit decision:
  // - invalid row -> 'unresolved'
  // - any row with groupKey, existing match, homonym, or intra-stage duplicate -> 'unresolved' until reviewed
  // - ungrouped novel row with 0 conflicts -> defaults to 'unresolved' unless user explicitly selects an action
  const effectiveDecisions = new Map<string, StagedRowUserDecision>();
  for (const row of table.rows) {
    const provided = userDecisions[row.rowId];
    effectiveDecisions.set(row.rowId, provided ?? { action: 'unresolved' });
  }

  // Analyze per-group active decisions (excluding 'skip')
  interface GroupTargetSummary {
    createRootRowIds: string[];
    linkStagedRowIds: string[];
    existingTargetConceptIds: Set<string>;
    hasUnresolvedRows: boolean;
  }

  const groupSummaries = new Map<string, GroupTargetSummary>();
  for (const row of table.rows) {
    if (!row.groupKey) continue;
    let summary = groupSummaries.get(row.groupKey);
    if (!summary) {
      summary = {
        createRootRowIds: [],
        linkStagedRowIds: [],
        existingTargetConceptIds: new Set<string>(),
        hasUnresolvedRows: false,
      };
      groupSummaries.set(row.groupKey, summary);
    }
    const dec = effectiveDecisions.get(row.rowId)!;
    if (dec.action === 'skip') continue;
    if (dec.action === 'unresolved') {
      summary.hasUnresolvedRows = true;
    } else if (dec.action === 'create-new-concept') {
      summary.createRootRowIds.push(row.rowId);
    } else if (dec.action === 'link-staged-group') {
      if (dec.groupKey !== row.groupKey) {
        // Linking to a different group key than row.groupKey is a group target conflict
        summary.existingTargetConceptIds.add(`__MISMATCHED_GROUP:${dec.groupKey}`);
      } else {
        summary.linkStagedRowIds.push(row.rowId);
      }
    } else if (dec.action === 'link-existing-concept') {
      summary.existingTargetConceptIds.add(dec.targetConceptId);
    }
  }

  // Track seen active intra-stage signatures so second+ active occurrence is flagged INTRA_STAGE_DUPLICATE
  const seenActiveStageSignatures = new Map<string, number>();

  const reviewedRows: ReviewedStagedRow[] = [];
  let createConceptCount = 0;
  let addExpressionToExistingCount = 0;
  let addExpressionToStagedGroupCount = 0;
  let skippedRowCount = 0;
  let unresolvedRowCount = 0;
  let blockingConflictRowCount = 0;

  for (const row of table.rows) {
    const decision = effectiveDecisions.get(row.rowId)!;
    const flags = new Set<StagedConflictFlag>();

    if (!row.isValidForPlanning || !row.stagedLanguage || !row.stagedRole) {
      if (decision.action === 'skip') {
        skippedRowCount += 1;
      } else {
        unresolvedRowCount += 1;
        blockingConflictRowCount += 1;
      }
      reviewedRows.push({
        row,
        classification: 'invalid-row',
        matchingExistingConceptIds: [],
        matchingExistingExpressions: [],
        matchesProtectedExistingExpression: false,
        advisorySimilarConceptIds: [],
        conflictFlags: [],
        decision,
        hasBlockingConflict: decision.action !== 'skip',
        isActionableOperation: false,
      });
      continue;
    }

    const exactMatches = existingBySurface.get(row.stagedTermText) ?? [];
    const matchingExistingConceptIds = sortUniqueStrings(exactMatches.map((e) => e.conceptId));
    const matchesProtectedExistingExpression = exactMatches.some((e) =>
      isExpressionProtected(e, snapshot.assertions),
    );

    let classification: StagedRowClassification = 'new-surface';
    if (matchingExistingConceptIds.length === 1) {
      classification = 'exact-single-concept-match';
    } else if (matchingExistingConceptIds.length > 1) {
      classification = 'ambiguous-multi-concept-homonym';
      flags.add('AMBIGUOUS_EXISTING_HOMONYM');
    }

    if (matchesProtectedExistingExpression) {
      flags.add('PROTECTED_EXISTING_MATCH');
    }

    // Advisory case/whitespace similarity (only for concepts not already in exactMatches)
    const foldKey = makeAdvisoryFoldKey(row.stagedTermText, row.stagedLanguage);
    const exactConceptSet = new Set(matchingExistingConceptIds);
    const foldCandidates = existingConceptsByFoldKey.get(foldKey);
    const advisorySimilarConceptIds = foldCandidates
      ? sortUniqueStrings(Array.from(foldCandidates).filter((cid) => !exactConceptSet.has(cid)))
      : [];
    if (advisorySimilarConceptIds.length > 0) {
      flags.add('ADVISORY_CASE_OR_WHITESPACE_SIMILARITY');
    }

    // Intra-stage duplicate and cross-group homonym checks
    const langStr = formatLanguageUse(row.stagedLanguage);
    const grpKey = row.groupKey ?? `__UNGROUPED_${row.rowId}`;
    const sig = `${grpKey}\u0000${row.stagedTermText}\u0000${langStr}\u0000${row.stagedRole}`;

    if ((stageSignatureCounts.get(sig) ?? 0) > 1) {
      if (decision.action !== 'skip') {
        const seenCount = (seenActiveStageSignatures.get(sig) ?? 0) + 1;
        seenActiveStageSignatures.set(sig, seenCount);
        if (seenCount > 1 || decision.action === 'unresolved') {
          flags.add('INTRA_STAGE_DUPLICATE');
        }
      } else {
        flags.add('INTRA_STAGE_DUPLICATE');
      }
    }

    const groupsForSurface = stageGroupsBySurface.get(row.stagedTermText);
    if (groupsForSurface && groupsForSurface.size > 1) {
      flags.add('INTRA_STAGE_CROSS_GROUP_HOMONYM');
    }

    // Check if an exact (text, language, role) already exists on the matched/targeted existing concept
    const hasExactSameConceptForm = (conceptId: string): boolean =>
      exactMatches.some(
        (e) =>
          e.conceptId === conceptId &&
          formatLanguageUse(e.language) === langStr &&
          e.role === row.stagedRole,
      );

    if (
      matchingExistingConceptIds.length === 1 &&
      hasExactSameConceptForm(matchingExistingConceptIds[0])
    ) {
      flags.add('EXACT_SAME_CONCEPT_DUPLICATE');
    }

    // Evaluate decision-specific conflicts
    let decisionConflict = false;

    if (decision.action === 'link-existing-concept') {
      if (!conceptsById.has(decision.targetConceptId)) {
        flags.add('INVALID_TARGET_CONCEPT');
        decisionConflict = true;
      } else if (hasExactSameConceptForm(decision.targetConceptId)) {
        flags.add('EXACT_SAME_CONCEPT_DUPLICATE');
        decisionConflict = true;
      }
    }

    if (row.groupKey) {
      const summary = groupSummaries.get(row.groupKey)!;
      const mixesNewAndExisting =
        (summary.createRootRowIds.length > 0 || summary.linkStagedRowIds.length > 0) &&
        summary.existingTargetConceptIds.size > 0;
      const multipleExistingTargets = summary.existingTargetConceptIds.size > 1;
      const multipleCreateRoots = summary.createRootRowIds.length > 1;

      if (mixesNewAndExisting || multipleExistingTargets || multipleCreateRoots) {
        flags.add('GROUP_TARGET_CONFLICT');
        if (decision.action !== 'skip') {
          decisionConflict = true;
        }
      }

      if (
        decision.action === 'link-staged-group' &&
        (decision.groupKey !== row.groupKey || summary.createRootRowIds.length !== 1)
      ) {
        flags.add('MISSING_GROUP_ROOT_CONCEPT');
        decisionConflict = true;
      }
    } else if (decision.action === 'link-staged-group') {
      // Cannot link to a staged group if the row has no groupKey
      flags.add('MISSING_GROUP_ROOT_CONCEPT');
      decisionConflict = true;
    }

    // Check active intra-stage duplicate blocking
    if (
      decision.action !== 'skip' &&
      flags.has('INTRA_STAGE_DUPLICATE') &&
      (seenActiveStageSignatures.get(sig) ?? 0) > 1
    ) {
      decisionConflict = true;
    }

    const sortedFlags = sortConflictFlags(flags);
    let hasBlockingConflict = false;
    let isActionableOperation = false;

    if (decision.action === 'skip') {
      skippedRowCount += 1;
      hasBlockingConflict = false;
      isActionableOperation = false;
    } else if (decision.action === 'unresolved') {
      unresolvedRowCount += 1;
      hasBlockingConflict = true;
      blockingConflictRowCount += 1;
    } else if (decisionConflict) {
      hasBlockingConflict = true;
      blockingConflictRowCount += 1;
    } else if (decision.action === 'create-new-concept') {
      createConceptCount += 1;
      isActionableOperation = true;
    } else if (decision.action === 'link-existing-concept') {
      addExpressionToExistingCount += 1;
      isActionableOperation = true;
    } else if (decision.action === 'link-staged-group') {
      addExpressionToStagedGroupCount += 1;
      isActionableOperation = true;
    }

    reviewedRows.push({
      row,
      classification,
      matchingExistingConceptIds,
      matchingExistingExpressions: exactMatches,
      matchesProtectedExistingExpression,
      advisorySimilarConceptIds,
      conflictFlags: sortedFlags,
      decision,
      hasBlockingConflict,
      isActionableOperation,
    });
  }

  const actionableTotal =
    createConceptCount + addExpressionToExistingCount + addExpressionToStagedGroupCount;

  const blockingReasons: string[] = [];
  if (table.hasBlockingParseIssues) {
    blockingReasons.push(
      'Delimited source contains blocking parse issues (irregular column count or blank-line errors).',
    );
  }
  if (unresolvedRowCount > 0) {
    blockingReasons.push(
      `${unresolvedRowCount} staged ${unresolvedRowCount === 1 ? 'row remains' : 'rows remain'} unresolved and require an explicit decision (create, link, or skip).`,
    );
  }
  if (blockingConflictRowCount > 0 && unresolvedRowCount === 0) {
    blockingReasons.push(
      `${blockingConflictRowCount} staged ${blockingConflictRowCount === 1 ? 'row has' : 'rows have'} blocking target or duplicate conflicts.`,
    );
  }
  if (actionableTotal === 0) {
    blockingReasons.push(
      'At least one staged row must be selected for concept creation or expression linking before building a proposal.',
    );
  }

  return deepFreeze({
    table,
    baseLibraryRevision: snapshot.libraryRevision,
    rows: reviewedRows,
    counts: {
      totalRows: table.rows.length,
      validRows: table.validRowCount,
      invalidRows: table.invalidRowCount,
      createConceptCount,
      addExpressionToExistingCount,
      addExpressionToStagedGroupCount,
      skippedRowCount,
      unresolvedRowCount,
      blockingConflictRowCount,
    },
    canBuildProposal: blockingReasons.length === 0,
    blockingReasons,
  });
}

/**
 * Deterministic helper to pre-populate sensible initial review decisions ONLY when requested
 * by the user (or for non-ambiguous rows), while leaving ambiguous homonyms, exact duplicates,
 * and invalid rows explicit so the user can review them.
 *
 * For a group with multiple novel forms: first valid row creates a new concept, subsequent rows
 * in that group link to the staged group.
 * For exact single-concept duplicate (same text, language, role): defaults to 'skip'.
 * For ambiguous multi-concept homonyms: remains 'unresolved' so the user must explicitly choose!
 */
export function buildSuggestedInitialDecisions(
  table: StagedMappedTable,
  snapshot: LibrarySnapshot,
): Record<string, StagedRowUserDecision> {
  const baseline = evaluateStagingReview(table, snapshot, {});
  const decisions: Record<string, StagedRowUserDecision> = {};
  const groupRootAssigned = new Set<string>();
  const seenStageSignatures = new Set<string>();

  for (const item of baseline.rows) {
    const { row } = item;
    if (!row.isValidForPlanning || !row.stagedLanguage || !row.stagedRole) {
      decisions[row.rowId] = { action: 'skip' };
      continue;
    }

    const langStr = formatLanguageUse(row.stagedLanguage);
    const grpKey = row.groupKey ?? `__UNGROUPED_${row.rowId}`;
    const sig = `${grpKey}\u0000${row.stagedTermText}\u0000${langStr}\u0000${row.stagedRole}`;

    if (seenStageSignatures.has(sig)) {
      decisions[row.rowId] = { action: 'skip' };
      continue;
    }
    seenStageSignatures.add(sig);

    // Ambiguous homonym across existing library concepts MUST remain unresolved until explicit user decision
    if (item.classification === 'ambiguous-multi-concept-homonym') {
      decisions[row.rowId] = { action: 'unresolved' };
      continue;
    }

    // Exact same-concept duplicate (same text + language + role already on that single concept) -> suggest skip
    if (item.conflictFlags.includes('EXACT_SAME_CONCEPT_DUPLICATE')) {
      decisions[row.rowId] = { action: 'skip' };
      continue;
    }

    if (row.groupKey) {
      if (!groupRootAssigned.has(row.groupKey)) {
        groupRootAssigned.add(row.groupKey);
        decisions[row.rowId] = { action: 'create-new-concept' };
      } else {
        decisions[row.rowId] = { action: 'link-staged-group', groupKey: row.groupKey };
      }
    } else {
      decisions[row.rowId] = { action: 'create-new-concept' };
    }
  }

  return decisions;
}
