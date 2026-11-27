import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const SYNTHETIC_MARKER = 'PRIVATE-SYNTHETIC-SLICE-991';

test.describe('C5 / G3: Integrated first-slice end-to-end journey', () => {
  test('fresh empty app -> paste -> review -> save EN/TR -> reload -> search -> export -> backup -> empty-origin restore exact snapshot', async ({
    page,
    browser,
  }) => {
    const requests: string[] = [];
    page.on('request', (req) => requests.push(`${req.url()} ${req.postData() ?? ''}`));

    // 1. Fresh empty library
    await page.goto('/library');
    await expect(page.getByText(/Your terminology library is empty/i)).toBeVisible();

    // 2. Navigate to Extraction and paste synthetic English text (session-only default)
    await page.getByRole('link', { name: 'Extraction', exact: true }).click();
    await page
      .getByLabel('English scientific source text')
      .fill(
        `Periodontal ligament stem cells express TNF-α and CD4+ markers in ${SYNTHETIC_MARKER}.`,
      );
    await page.getByRole('button', { name: 'Analyze locally' }).click();

    // 3. Review discovered unknown scientific term TNF-α and approve creating a new concept
    await expect(page.getByText('TNF-α').first()).toBeVisible();
    const tnfRow = page.locator('tr', { hasText: 'TNF-α' }).first();
    await tnfRow.getByRole('button', { name: 'Create concept' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Approve and save' }).click();

    // 4. Reload extraction and confirm session-only source text is not persisted
    await page.reload();
    await expect(page.getByLabel('English scientific source text')).toHaveValue('');

    // 5. Open Library, verify TNF-α persisted, add Turkish expression
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.getByText('TNF-α')).toBeVisible();

    await page.getByRole('button', { name: 'Add expression' }).first().click();
    await page.getByLabel('Expression text').fill('tümör nekroz faktörü alfa');
    await page.getByLabel('Expression language').selectOption('tr');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await page.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page.getByText('tümör nekroz faktörü alfa')).toBeVisible();

    // Reload and verify case-sensitive search works after reload
    await page.reload();
    await page.getByLabel('Search expressions (case-sensitive)').fill('TNF-α');
    await expect(page.getByText('TNF-α')).toBeVisible();
    await page.getByLabel('Search expressions (case-sensitive)').fill('tnf-α');
    await expect(page.getByText(/No matching expressions/i)).toBeVisible();
    await page.getByLabel('Search expressions (case-sensitive)').fill('');

    // 6. Export CSV + download complete backup
    await page.getByRole('link', { name: 'Export & Recovery', exact: true }).click();
    const csvDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download CSV export/i }).click();
    const csvDownload = await csvDownloadPromise;
    const csvPath = await csvDownload.path();
    const csvText = csvPath ? await readFile(csvPath, 'utf8') : '';
    expect(csvText).toContain('TNF-α');
    expect(csvText).toContain('tümör nekroz faktörü alfa');

    const backupPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download complete backup/i }).click();
    const backupDownload = await backupPromise;
    const backupPath = await backupDownload.path();
    const backupJson = backupPath ? await readFile(backupPath, 'utf8') : '';
    const originalBackup = JSON.parse(backupJson);
    expect(originalBackup.format).toBe('termforge-backup');
    expect(originalBackup.snapshot.documents).toHaveLength(0);
    expect(backupJson).not.toContain(SYNTHETIC_MARKER);

    // 7. Restore into isolated empty context and verify exact canonical snapshot parity
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto('http://127.0.0.1:3100/exchange');
    await freshPage.getByLabel(/Select portable backup file/i).setInputFiles({
      name: 'termforge-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson, 'utf8'),
    });
    await freshPage.getByRole('button', { name: /Confirm atomic restore/i }).click();
    await expect(freshPage.getByText(/Restored validated backup atomically/i)).toBeVisible();

    const reBackupPromise = freshPage.waitForEvent('download');
    await freshPage.getByRole('button', { name: /Download complete backup/i }).click();
    const reBackupDownload = await reBackupPromise;
    const reBackupPath = await reBackupDownload.path();
    const restoredBackup = JSON.parse(reBackupPath ? await readFile(reBackupPath, 'utf8') : '{}');
    expect(restoredBackup.digest).toBe(originalBackup.digest);
    expect(restoredBackup.snapshot).toEqual(originalBackup.snapshot);

    await freshContext.close();

    // 8. Verify zero network transmission of synthetic source marker or external calls
    expect(requests.some((r) => r.includes(SYNTHETIC_MARKER))).toBe(false);
    expect(
      requests.filter((r) => !r.startsWith('http://127.0.0.1:3100') && !r.startsWith('blob:')),
    ).toEqual([]);
  });
});
