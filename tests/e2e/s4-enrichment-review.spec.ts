import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { APPROVED_SYNTHETIC_IMPORT_FIXTURES } from '../../src/domain/delimited-intake';

test.describe('WP04 S4: Bounded synthetic source enrichment & AI review exchange workspace', () => {
  test('executes end-to-end offline enrichment flow with disabled remote sources, arbitrary upload blocking, synthetic 3/3 comparison, H1/H2 pre-commit backup gate, canonical reload persistence, zero external requests, and empty-context restore', async ({
    page,
    context,
  }) => {
    const consoleErrors: string[] = [];
    const requests: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('request', (req) => requests.push(`${req.url()} ${req.postData() ?? ''}`));

    // 1. Seed browser IndexedDB library via WP03 approved synthetic CSV fixture
    await page.goto('/exchange');
    await expect(page.getByTestId('nav-enrichment-link')).toHaveAttribute('href', '/enrichment');

    const bilingualFixture = APPROVED_SYNTHETIC_IMPORT_FIXTURES.find(
      (f) => f.id === 'synth-bilingual-dirty-csv-v1',
    )!;
    await page.getByTestId('synthetic-delimited-file-input').setInputFiles({
      name: bilingualFixture.filename,
      mimeType: 'text/csv',
      buffer: Buffer.from(bilingualFixture.rawText, 'utf8'),
    });
    await page.getByTestId('build-import-proposal-btn').click();
    const importBackupPromise = page.waitForEvent('download');
    await page.getByTestId('offer-precommit-backup-btn').click();
    await importBackupPromise;
    await page.getByTestId('precommit-ack-checkbox').check();
    await page.getByTestId('approve-apply-import-btn').click();
    await expect(page.getByTestId('import-commit-notice')).toContainText(/library revision 1/i);

    // 2. Navigate to /enrichment workspace and verify explicit synthetic disclosures
    await page.getByTestId('nav-enrichment-link').click();
    await expect(page).toHaveURL(/\/enrichment/);
    await expect(page.getByTestId('wp04-synthetic-gate-banner')).toContainText(/G4 NOT READY/i);
    await expect(page.getByTestId('unsupported-live-provider-notice')).toContainText(
      /synthetic review simulation mode/i,
    );

    // Verify conditional remote source (MeSH) explicitly shows DISABLED metadata card
    await page.getByTestId('f3-source-select').selectOption('nlm-mesh');
    await expect(page.getByTestId('f3-source-policy-card')).toContainText(/Disabled under synthetic gate/i);
    await page.getByTestId('f3-source-select').selectOption('synth-bilingual-lexicon-v1');

    // 3. Filter for p53 (shared symbol missing TR) -> select -> look up offline synthetic evidence -> build packet
    await page.getByLabel('Search concept ID or form').fill('p53');
    const firstSelectCheckbox = page.locator('input[data-testid^="select-target-"]').first();
    await firstSelectCheckbox.check();
    await expect(page.getByTestId('selected-targets-count')).toContainText('1 selected');

    await page.getByTestId('lookup-source-btn').click();
    await expect(page.getByTestId('f3-source-results')).toContainText('tümör baskılayıcı p53');

    await page.getByTestId('build-packet-btn').click();
    await expect(page.getByTestId('f4-packet-preview')).toBeVisible();
    await expect(page.getByTestId('download-packet-btn')).toBeDisabled();
    await page.getByTestId('packet-consent-checkbox').check();
    await expect(page.getByTestId('download-packet-btn')).toBeEnabled();

    const packetDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-packet-btn').click();
    const packetDownload = await packetDownloadPromise;
    expect(packetDownload.suggestedFilename()).toMatch(/termforge-review-packet-.*\.json/i);

    // 4. Reject arbitrary unallowlisted external response upload fail-closed
    await page.getByTestId('upload-response-file-input').setInputFiles({
      name: 'real-external-model.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"termforge-review-response","version":1}', 'utf8'),
    });
    await expect(page.getByTestId('enrichment-error-banner')).toContainText(
      /not in the synthetic fixture allowlist/i,
    );
    await expect(page.getByTestId('f6-invalid-count')).toContainText('1');

    // 5. Simulate 3/3 deterministic synthetic responses, select suggestion, and build proposal
    await page.getByTestId('simulate-responses-btn').click();
    await expect(page.getByTestId('f6-comparison-panel')).toBeVisible();
    await expect(page.getByTestId('f6-responded-count')).toContainText('3 / 3');

    await page.getByTestId('select-comparison-group-0').check();
    await page.getByTestId('build-enrichment-proposal-btn').click();
    await expect(page.getByTestId('f7-planned-proposal-panel')).toBeVisible();

    // H1 guard: ack checkbox and commit MUST remain disabled before offering pre-commit backup
    await expect(page.getByTestId('enrichment-backup-required-banner')).toBeVisible();
    await expect(page.getByTestId('enrichment-precommit-ack')).toBeDisabled();
    await expect(page.getByTestId('approve-commit-enrichment-btn')).toBeDisabled();

    const preBackupPromise = page.waitForEvent('download');
    await page.getByTestId('enrichment-offer-backup-btn').click();
    const preBackupDownload = await preBackupPromise;
    expect(preBackupDownload.suggestedFilename()).toMatch(/termforge-pre-enrichment-backup-rev1/i);

    await expect(page.getByTestId('enrichment-precommit-ack')).toBeEnabled();
    await page.getByTestId('enrichment-precommit-ack').check();
    await expect(page.getByTestId('approve-commit-enrichment-btn')).toBeEnabled();
    await page.getByTestId('approve-commit-enrichment-btn').click();

    await expect(page.getByTestId('enrichment-status-banner')).toContainText(/library revision 2/i);

    // 6. Reload verifies ephemeral state cleared and canonical Rev 2 persisted in IndexedDB
    await page.reload();
    await expect(page.getByTestId('header-revision')).toHaveText('Rev 2');
    await expect(page.getByTestId('f4-packet-preview')).toHaveCount(0);
    await expect(page.getByTestId('f6-comparison-panel')).toHaveCount(0);

    // 7. Export final portable backup on /exchange and restore cleanly into empty browser context
    await page.goto('/exchange');
    const finalBackupPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Create & download backup' }).click();
    const finalBackupDownload = await finalBackupPromise;
    const backupPath = await finalBackupDownload.path();
    expect(backupPath).toBeTruthy();
    const backupContent = await readFile(backupPath!, 'utf8');
    expect(backupContent).not.toContain('synthetic-local-simulator');

    const emptyContext = await context.browser()!.newContext();
    try {
      const emptyPage = await emptyContext.newPage();
      await emptyPage.goto('/exchange');
      await emptyPage.getByLabel('Select backup file (.json)').setInputFiles(backupPath!);
      await expect(emptyPage.getByTestId('restore-preview')).toContainText(/Rev 2/i);
      await emptyPage.getByRole('button', { name: 'Approve & restore backup' }).click();
      await expect(emptyPage.getByTestId('header-revision')).toHaveText('Rev 2');
    } finally {
      await emptyContext.close();
    }

    // Zero remote HTTP requests and zero console errors
    expect(requests.filter((r) => !r.startsWith('http://127.0.0.1:3100'))).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
