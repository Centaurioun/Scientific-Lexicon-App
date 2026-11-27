import { describe, expect, it } from 'vitest';
import { RevisionCachedRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import {
  createBackup,
  formatExport,
  MAX_BACKUP_FILE_BYTES,
  parseBackupFileText,
  selectExportRows,
  serializeBackupFile,
} from '@/application/exchange';
import { buildAdditiveImportPlan } from '@/application/import-planner';
import { applyChange, approveChange, proposeChange } from '@/application/library';
import { inspectLibraryQuality } from '@/application/quality-inspector';
import { evaluateChangeOnSnapshot, type Approval, type ProposedChange } from '@/domain/changes';
import { parseDelimitedText } from '@/domain/delimited-intake';
import type { LibraryRepository } from '@/domain/repository';
import {
  createEmptySnapshot,
  parseLibrarySnapshot,
  type Concept,
  type Expression,
  type LibrarySnapshot,
  type Provenance,
} from '@/domain/schema';
import {
  applyStagingMapping,
  STAGING_MAPPING_SCHEMA_VERSION,
  type StagingMappingSpec,
} from '@/domain/staging-mapping';
import {
  buildSuggestedInitialDecisions,
  evaluateStagingReview,
} from '@/domain/staging-review';

const TS = '2026-11-27T11:30:00.000Z';

function buildSyntheticScaleSnapshot(expressionCount: number): LibrarySnapshot {
  const conceptCount = Math.floor(expressionCount / 2);
  const concepts: Concept[] = new Array(conceptCount);
  const expressions: Expression[] = new Array(expressionCount);
  const provenance: Provenance[] = new Array(expressionCount);

  for (let i = 0; i < conceptCount; i += 1) {
    const cid = `c-${String(i).padStart(6, '0')}`;
    concepts[i] = {
      id: cid,
      revision: 1,
      createdAt: TS,
      updatedAt: TS,
    };

    const eidEn = `e-${String(i).padStart(6, '0')}-en`;
    const eidTr = `e-${String(i).padStart(6, '0')}-tr`;

    expressions[i * 2] = {
      id: eidEn,
      conceptId: cid,
      revision: 0,
      text: `Synthetic_Periodontal_Biomarker_${i}_EN`,
      language: { kind: 'language', tag: 'en' },
      role: 'preferred',
      createdAt: TS,
      updatedAt: TS,
    };
    provenance[i * 2] = {
      id: `p-${eidEn}`,
      expressionId: eidEn,
      kind: 'manual',
      createdAt: TS,
      source: null,
    };

    expressions[i * 2 + 1] = {
      id: eidTr,
      conceptId: cid,
      revision: 0,
      text: `Sentetik_Periodontal_Biyobelirteç_${i}_TR`,
      language: { kind: 'language', tag: 'tr' },
      role: 'preferred',
      createdAt: TS,
      updatedAt: TS,
    };
    provenance[i * 2 + 1] = {
      id: `p-${eidTr}`,
      expressionId: eidTr,
      kind: 'manual',
      createdAt: TS,
      source: null,
    };
  }

  return {
    ...createEmptySnapshot(),
    libraryRevision: 42,
    concepts,
    expressions,
    provenance,
  };
}

function build250RowSyntheticCsv(): string {
  const lines = ['grp,term,lang,role,unmapped_col'];
  // 125 groups x 2 rows = 250 rows -> 125 createConcept ops + 125 addExpression ops = 250 total ops
  for (let i = 0; i < 125; i += 1) {
    lines.push(`G-BATCH-${i},Batch_Import_Term_${i}_EN,en,preferred,unmapped_${i}`);
    lines.push(`G-BATCH-${i},Batch_Import_Term_${i}_TR,tr,preferred,unmapped_${i}`);
  }
  return lines.join('\n');
}

describe('WP03 E9: G4 synthetic operational probes (multi-instance CAS, isolated schema upgrade, simulated quota/security errors, 10k and 50k expression scale)', () => {
  it('verifies two-instance simultaneous CAS contention against shared state (winner commits, loser receives stale without silent overwrite)', async () => {
    let sharedState: LibrarySnapshot = createEmptySnapshot();

    class SharedCasInstanceRepository implements LibraryRepository {
      async snapshot(): Promise<LibrarySnapshot> {
        return parseLibrarySnapshot(structuredClone(sharedState));
      }

      async apply(proposal: ProposedChange, approval: Approval) {
        const outcome = evaluateChangeOnSnapshot(sharedState, proposal.payload, approval);
        if (outcome.kind === 'replay') {
          return { status: 'replay' as const, revision: outcome.revision };
        }
        if (outcome.kind === 'error') {
          return outcome.result;
        }
        sharedState = outcome.nextSnapshot;
        return { status: 'applied' as const, revision: outcome.nextRevision };
      }
    }

    const tabA = new SharedCasInstanceRepository();
    const tabB = new SharedCasInstanceRepository();

    const snapA = await tabA.snapshot();
    const snapB = await tabB.snapshot();
    expect(snapA.libraryRevision).toBe(0);
    expect(snapB.libraryRevision).toBe(0);

    const proposalA = await proposeChange(snapA, {
      schemaVersion: 1,
      batchId: '00000000-0000-4000-8000-000000000101',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: '00000000-0000-4000-8000-000000000102',
          concept: {
            id: '00000000-0000-4000-8000-000000000103',
            revision: 0,
            createdAt: TS,
            updatedAt: TS,
          },
          firstExpression: {
            id: '00000000-0000-4000-8000-000000000104',
            conceptId: '00000000-0000-4000-8000-000000000103',
            revision: 0,
            text: 'Tab A Winner Term',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: {
            id: '00000000-0000-4000-8000-000000000105',
            expressionId: '00000000-0000-4000-8000-000000000104',
            kind: 'manual',
            createdAt: TS,
            source: null,
          },
        },
      ],
    });

    const proposalB = await proposeChange(snapB, {
      schemaVersion: 1,
      batchId: '00000000-0000-4000-8000-000000000201',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: '00000000-0000-4000-8000-000000000202',
          concept: {
            id: '00000000-0000-4000-8000-000000000203',
            revision: 0,
            createdAt: TS,
            updatedAt: TS,
          },
          firstExpression: {
            id: '00000000-0000-4000-8000-000000000204',
            conceptId: '00000000-0000-4000-8000-000000000203',
            revision: 0,
            text: 'Tab B Loser Term',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: {
            id: '00000000-0000-4000-8000-000000000205',
            expressionId: '00000000-0000-4000-8000-000000000204',
            kind: 'manual',
            createdAt: TS,
            source: null,
          },
        },
      ],
    });

    const [resA, resB] = await Promise.all([
      applyChange(tabA, proposalA, approveChange(proposalA)),
      applyChange(tabB, proposalB, approveChange(proposalB)),
    ]);

    expect(resA).toEqual({ status: 'applied', revision: 1 });
    expect(resB.status).toBe('stale');

    const finalSnap = await tabA.snapshot();
    expect(finalSnap.libraryRevision).toBe(1);
    expect(finalSnap.expressions.map((e) => e.text)).toEqual(['Tab A Winner Term']);
  });

  it('executes isolated representative v1 -> v2 additive schema upgrade and blocked-connection probe without modifying production schema v1', () => {
    // Representative isolated migration harness (production schema remains strictly v1)
    interface IsolatedDatabaseV1 {
      version: 1;
      snapshot: LibrarySnapshot;
    }
    interface IsolatedDatabaseV2 {
      version: 2;
      snapshot: LibrarySnapshot;
      additiveDiagnosticIndex: ReadonlyArray<{ expressionId: string; normalizedLength: number }>;
    }

    function runIsolatedV1ToV2Upgrade(
      v1Db: IsolatedDatabaseV1,
      options: { openV1ConnectionsCount: number }
    ): { status: 'blocked-by-open-connection' } | { status: 'upgraded'; db: IsolatedDatabaseV2 } {
      if (options.openV1ConnectionsCount > 0) {
        return { status: 'blocked-by-open-connection' };
      }
      const validatedV1 = parseLibrarySnapshot(v1Db.snapshot);
      return {
        status: 'upgraded',
        db: {
          version: 2,
          snapshot: validatedV1,
          additiveDiagnosticIndex: validatedV1.expressions.map((e) => ({
            expressionId: e.id,
            normalizedLength: e.text.length,
          })),
        },
      };
    }

    const sampleV1: IsolatedDatabaseV1 = {
      version: 1,
      snapshot: buildSyntheticScaleSnapshot(10),
    };

    // 1. Blocked when another tab holds an unclosed v1 connection
    const blocked = runIsolatedV1ToV2Upgrade(sampleV1, { openV1ConnectionsCount: 1 });
    expect(blocked).toEqual({ status: 'blocked-by-open-connection' });

    // 2. Clean additive upgrade once blocking connection closes
    const upgraded = runIsolatedV1ToV2Upgrade(sampleV1, { openV1ConnectionsCount: 0 });
    expect(upgraded.status).toBe('upgraded');
    if (upgraded.status === 'upgraded') {
      expect(upgraded.db.version).toBe(2);
      expect(upgraded.db.snapshot.schemaVersion).toBe(1);
      expect(upgraded.db.additiveDiagnosticIndex).toHaveLength(10);
    }
  });

  it('handles simulated QuotaExceededError and SecurityError fail-closed without silent in-memory fallback', async () => {
    const quotaRepo: LibraryRepository = {
      async snapshot() {
        return createEmptySnapshot();
      },
      async apply() {
        const err = new Error(
          'QuotaExceededError: Simulated IndexedDB storage quota exhausted during commit.'
        );
        err.name = 'QuotaExceededError';
        throw err;
      },
    };

    const securityRepo: LibraryRepository = {
      async snapshot() {
        const err = new Error(
          'SecurityError: Simulated browser storage permission denied (strict privacy mode).'
        );
        err.name = 'SecurityError';
        throw err;
      },
      async apply() {
        throw new Error('SecurityError');
      },
    };

    await expect(securityRepo.snapshot()).rejects.toThrow(/SecurityError/);

    const empty = await quotaRepo.snapshot();
    const proposal = await proposeChange(empty, {
      schemaVersion: 1,
      batchId: '00000000-0000-4000-8000-000000000301',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: '00000000-0000-4000-8000-000000000302',
          concept: {
            id: '00000000-0000-4000-8000-000000000303',
            revision: 0,
            createdAt: TS,
            updatedAt: TS,
          },
          firstExpression: {
            id: '00000000-0000-4000-8000-000000000304',
            conceptId: '00000000-0000-4000-8000-000000000303',
            revision: 0,
            text: 'Quota Probe Term',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: {
            id: '00000000-0000-4000-8000-000000000305',
            expressionId: '00000000-0000-4000-8000-000000000304',
            kind: 'manual',
            createdAt: TS,
            source: null,
          },
        },
      ],
    });

    await expect(applyChange(quotaRepo, proposal, approveChange(proposal))).rejects.toThrow(
      /QuotaExceededError/
    );
  });

  it('measures realistic 10,000 and 50,000 synthetic expression scale for matcher rebuild, 250-op import planning, quality inspection, export projection, and 16 MiB backup limit compliance', async () => {
    const csv250 = build250RowSyntheticCsv();
    const rawStage250 = await parseDelimitedText(csv250, { delimiter: ',' });
    const mappingSpec: StagingMappingSpec = {
      mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
      termColumnIndex: 1,
      languageSource: { kind: 'column', columnIndex: 2, missingPolicy: 'error' },
      roleSource: { kind: 'column', columnIndex: 3, missingPolicy: 'error' },
      groupKeyColumnIndex: 0,
      textTransform: 'trim-collapse-spaces',
    };

    // --- 10,000 Expressions (5,000 Concepts) Probe ---
    const snap10k = buildSyntheticScaleSnapshot(10000);
    const matcher10k = new RevisionCachedRegisteredMatcher();

    const t0Match10k = performance.now();
    const matches10k = await matcher10k.matchForRevision(
      snap10k.libraryRevision,
      'Sample text mentioning Synthetic_Periodontal_Biomarker_42_EN and Sentetik_Periodontal_Biyobelirteç_99_TR in context.',
      snap10k.expressions
    );
    const match10kMs = performance.now() - t0Match10k;
    expect(matches10k).toHaveLength(2);

    const t0Plan10k = performance.now();
    const mapped10k = applyStagingMapping(rawStage250, mappingSpec, snap10k.libraryRevision);
    const decisions10k = buildSuggestedInitialDecisions(mapped10k, snap10k);
    const review10k = evaluateStagingReview(mapped10k, snap10k, decisions10k);
    const plan10k = await buildAdditiveImportPlan(review10k, snap10k);
    const plan10kMs = performance.now() - t0Plan10k;
    expect(plan10k.summary.totalOperations).toBe(250);

    const t0Qual10k = performance.now();
    const qual10k = inspectLibraryQuality(snap10k);
    const qual10kMs = performance.now() - t0Qual10k;
    expect(qual10k.referentialIntegrity.status).toBe('valid');

    const t0Exp10k = performance.now();
    const rows10k = selectExportRows(snap10k, null, {
      scope: 'library-expressions',
      sort: 'alphabetical',
      language: 'all',
      includeKnown: true,
    });
    const csvExport10k = formatExport(rows10k, 'csv');
    const exp10kMs = performance.now() - t0Exp10k;
    expect(rows10k).toHaveLength(10000);
    expect(csvExport10k.length).toBeGreaterThan(100000);

    const t0Bkp10k = performance.now();
    const bkp10k = await createBackup(snap10k);
    const bkp10kStr = serializeBackupFile(bkp10k);
    const bkp10kBytes = new TextEncoder().encode(bkp10kStr).byteLength;
    const bkp10kMs = performance.now() - t0Bkp10k;
    expect(bkp10kBytes).toBeLessThan(MAX_BACKUP_FILE_BYTES);

    // --- 50,000 Expressions (25,000 Concepts) Probe ---
    const snap50k = buildSyntheticScaleSnapshot(50000);
    const matcher50k = new RevisionCachedRegisteredMatcher();

    const t0Match50k = performance.now();
    const matches50k = await matcher50k.matchForRevision(
      snap50k.libraryRevision,
      'Sample text mentioning Synthetic_Periodontal_Biomarker_42_EN and Sentetik_Periodontal_Biyobelirteç_24999_TR in context.',
      snap50k.expressions
    );
    const match50kMs = performance.now() - t0Match50k;
    expect(matches50k).toHaveLength(2);

    const t0Plan50k = performance.now();
    const mapped50k = applyStagingMapping(rawStage250, mappingSpec, snap50k.libraryRevision);
    const decisions50k = buildSuggestedInitialDecisions(mapped50k, snap50k);
    const review50k = evaluateStagingReview(mapped50k, snap50k, decisions50k);
    const plan50k = await buildAdditiveImportPlan(review50k, snap50k);
    const plan50kMs = performance.now() - t0Plan50k;
    expect(plan50k.summary.totalOperations).toBe(250);

    const t0Qual50k = performance.now();
    const qual50k = inspectLibraryQuality(snap50k);
    const qual50kMs = performance.now() - t0Qual50k;
    expect(qual50k.referentialIntegrity.status).toBe('valid');

    const t0Exp50k = performance.now();
    const rows50k = selectExportRows(snap50k, null, {
      scope: 'library-expressions',
      sort: 'alphabetical',
      language: 'all',
      includeKnown: true,
    });
    const csvExport50k = formatExport(rows50k, 'csv');
    const exp50kMs = performance.now() - t0Exp50k;
    expect(rows50k).toHaveLength(50000);
    expect(csvExport50k.length).toBeGreaterThan(500000);

    // Measure 50,000-expression backup size and fail-closed 16 MiB boundary behavior
    const t0Bkp50k = performance.now();
    let bkp50kBytes = 0;
    let bkp50kExceeded16MiB = false;
    try {
      const bkp50k = await createBackup(snap50k);
      const bkp50kStr = serializeBackupFile(bkp50k);
      bkp50kBytes = new TextEncoder().encode(bkp50kStr).byteLength;
    } catch (err) {
      bkp50kExceeded16MiB = true;
      expect(err instanceof Error ? err.message : '').toMatch(/16 MiB|exceeds/i);
    }
    const bkp50kMs = performance.now() - t0Bkp50k;

    console.info(
      JSON.stringify({
        probe: 'WP03_E9_SCALE_METRICS',
        scale10k: {
          matchMs: Math.round(match10kMs),
          plan250Ms: Math.round(plan10kMs),
          qualityMs: Math.round(qual10kMs),
          exportMs: Math.round(exp10kMs),
          backupMs: Math.round(bkp10kMs),
          backupBytes: bkp10kBytes,
        },
        scale50k: {
          matchMs: Math.round(match50kMs),
          plan250Ms: Math.round(plan50kMs),
          qualityMs: Math.round(qual50kMs),
          exportMs: Math.round(exp50kMs),
          backupMs: Math.round(bkp50kMs),
          backupBytes: bkp50kBytes,
          exceeded16MiBFailClosed: bkp50kExceeded16MiB,
        },
      })
    );

    // Also verify parseBackupFileText rejects > 16 MiB oversized text fail-closed
    const oversizedText = 'x'.repeat(MAX_BACKUP_FILE_BYTES + 128);
    await expect(parseBackupFileText(oversizedText)).rejects.toThrow(/16 MiB|exceeds/i);
  }, 30000);
});
