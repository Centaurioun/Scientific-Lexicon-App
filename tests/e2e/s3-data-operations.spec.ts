import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { APPROVED_SYNTHETIC_IMPORT_FIXTURES } from '../../src/domain/delimited-intake';

test.describe('WP03 S3: Reviewed synthetic data operations, quality inspector, and privacy/recovery drill', () => {
  test('rejects unapproved CSV upload, stages allowlisted synthetic fixture, enforces pre-commit backup & loss acknowledgment, commits additive import, verifies skipped/unmapped privacy exclusion, inspects quality findings, and restores into empty browser context', async ({
    page,
    context,
  }) => {
    const consoleLogs: string[] = [];
    const requests: string[] = [];
    page.on('console', (msg) => consoleLogs.push(msg.text()));
    page.on('request', (req) => requests.push(`${req.url()} ${req.postData() ?? ''}`));

    await page.goto('/exchange');
    await expect(page.getByTestId('data-operations-panel')).toBeVisible();
    await expect(page.getByTestId('wp03-synthetic-only-banner')).toContainText(/G4 NOT READY/i);
    await expect(page.getByTestId('quality-inspector-panel')).toBeVisible();

    // 1. Reject unapproved arbitrary CSV upload fail-closed before staging
    await page.getByTestId('synthetic-delimited-file-input').setInputFiles({
      name: 'unapproved-real-spreadsheet.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('term,lang\nunauthorized real term,en\n', 'utf8'),
    });
    await expect(page.getByTestId('delimited-intake-error')).toContainText(
      /not in the approved WP03 synthetic fixture allowlist/i
    );

    // 2. Upload allowlisted synthetic privacy & recovery drill CSV fixture
    const privacyFixture = APPROVED_SYNTHETIC_IMPORT_FIXTURES.find(
      (f) => f.id === 'synth-privacy-recovery-drill-csv-v1'
    )!;
    await page.getByTestId('synthetic-delimited-file-input').setInputFiles({
      name: privacyFixture.filename,
      mimeType: 'text/csv',
      buffer: Buffer.from(privacyFixture.rawText, 'utf8'),
    });

    await expect(page.getByTestId('delimited-intake-notice')).toContainText(
      /Verified and staged uploaded synthetic file/i
    );
    await expect(page.getByTestId('unmapped-loss-summary')).toContainText(
      /raw_only_unmapped_secret/i
    );

    // 3. Explicitly skip row 3 (SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST)
    await page.getByTestId('decision-select-row-3').selectOption('skip');
    await expect(page.getByTestId('staged-skipped-rows')).toHaveText('1');

    // 4. Build immutable additive import proposal
    await page.getByTestId('build-import-proposal-btn').click();
    await expect(page.getByTestId('planned-import-preview')).toBeVisible();
    await expect(page.getByTestId('proposal-total-ops')).toHaveText('2');

    // Approve button is disabled until pre-commit backup / loss contract acknowledgment is checked
    await expect(page.getByTestId('approve-apply-import-btn')).toBeDisabled();

    // Offer pre-commit backup download
    const preBackupDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('offer-precommit-backup-btn').click();
    const preBackupDownload = await preBackupDownloadPromise;
    expect(preBackupDownload.suggestedFilename()).toMatch(/termforge-pre-import-backup-rev0/i);
    await expect(page.getByTestId('precommit-backup-notice')).toContainText(
      /browser download initiation cannot verify/i
    );

    // Check acknowledgment & commit atomic batch
    await page.getByTestId('precommit-ack-checkbox').check();
    await expect(page.getByTestId('approve-apply-import-btn')).toBeEnabled();
    await page.getByTestId('approve-apply-import-btn').click();

    await expect(page.getByTestId('import-commit-notice')).toContainText(
      /Committed reviewed additive import batch \(2 operations\) atomically at library revision 1/i
    );

    // 5. Stage primary 12-row dirty bilingual CSV fixture (includes PD homonyms across GRP-PD-1 and GRP-PD-2)
    await page.getByLabel('Approved synthetic fixture').selectOption('synth-bilingual-dirty-csv-v1');
    await page.getByTestId('stage-builtin-fixture-btn').click();
    await expect(page.getByTestId('staged-total-rows')).toHaveText('12');

    await page.getByTestId('build-import-proposal-btn').click();
    await expect(page.getByTestId('planned-import-preview')).toBeVisible();
    await page.getByTestId('precommit-ack-checkbox').check();
    await page.getByTestId('approve-apply-import-btn').click();
    await expect(page.getByTestId('import-commit-notice')).toContainText(/library revision 2/i);

    // 6. Verify Read-Only Quality & Maintenance Inspector (E7)
    await expect(page.getByTestId('quality-integrity-badge')).toContainText(/VALID/i);
    await expect(page.getByTestId('quality-count-homonyms')).toContainText('1'); // 'PD' shared across GRP-PD-1 and GRP-PD-2

    await page.getByTestId('quality-tab-homonyms').click();
    await expect(page.getByTestId('quality-table-homonyms')).toContainText('PD');
    await expect(page.getByTestId('quality-table-homonyms')).toContainText(
      /Non-error scientific homonym/i
    );

    // 7. Reload page & verify privacy exclusion across IndexedDB, localStorage, sessionStorage, backup, and exports
    await page.reload();
    await expect(page.getByTestId('export-preview')).toContainText('SYNTH_APPROVED_IMPORT_TERM_E8');
    await expect(page.getByTestId('export-preview')).not.toContainText(
      'SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST'
    );
    await expect(page.getByTestId('export-preview')).not.toContainText(
      'SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST'
    );

    const storageDump = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
    }));
    expect(storageDump.local).not.toContain('SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST');
    expect(storageDump.local).not.toContain('SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST');
    expect(storageDump.session).not.toContain('SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST');
    expect(storageDump.session).not.toContain('SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST');

    // Download post-commit portable backup and restore into independent empty browser context
    const postBackupPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download complete backup/i }).click();
    const postBackupDownload = await postBackupPromise;
    const postBackupPath = await postBackupDownload.path();
    const postBackupText = postBackupPath ? await readFile(postBackupPath, 'utf8') : '';

    expect(postBackupText).toContain('SYNTH_APPROVED_IMPORT_TERM_E8');
    expect(postBackupText).not.toContain('SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST');
    expect(postBackupText).not.toContain('SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST');

    const emptyContext = await context.browser()!.newContext();
    const emptyPage = await emptyContext.newPage();
    await emptyPage.goto('/exchange');
    await emptyPage.getByLabel(/Select portable backup file/i).setInputFiles({
      name: 'wp03-post-import-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(postBackupText, 'utf8'),
    });
    await expect(emptyPage.getByTestId('restore-preview')).toBeVisible();
    await emptyPage.getByRole('button', { name: /Confirm atomic restore/i }).click();
    await expect(emptyPage.getByText(/Restored validated backup atomically/i)).toBeVisible();
    await expect(emptyPage.getByTestId('export-preview')).toContainText(
      'SYNTH_APPROVED_IMPORT_TERM_E8'
    );
    await emptyContext.close();

    // Verify no leaked terms in URLs, console logs, or external network requests
    expect(page.url()).not.toContain('SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST');
    expect(consoleLogs.join('\n')).not.toContain('SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST');
    expect(consoleLogs.join('\n')).not.toContain(
      'SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST'
    );
    expect(
      requests.filter((r) => !r.startsWith('http://127.0.0.1:3100') && !r.startsWith('blob:'))
    ).toEqual([]);
  });
});
