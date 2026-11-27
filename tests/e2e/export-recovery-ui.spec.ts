import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.describe('C4: Export and recovery workspace', () => {
  test('downloads TXT/MD/CSV/JSON exports, creates backup, rejects invalid file, refuses non-empty restore, and restores into empty DB', async ({
    page,
    context,
  }) => {
    const consoleLogs: string[] = [];
    const requests: string[] = [];
    page.on('console', (msg) => consoleLogs.push(msg.text()));
    page.on('request', (req) => requests.push(`${req.url()} ${req.postData() ?? ''}`));

    // Seed two concepts with formula-sensitive and comma-containing text through approved Library UI
    await page.goto('/library');
    await expect(page.getByText(/Your terminology library is empty/i)).toBeVisible();

    await page.getByRole('button', { name: 'New concept' }).click();
    await page.getByLabel('Initial expression text').fill('2,4-dinitrophenol');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page.getByText('2,4-dinitrophenol')).toBeVisible();

    await page.getByRole('button', { name: 'New concept' }).click();
    await page.getByLabel('Initial expression text').fill('=1+1');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await page.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page.getByText('=1+1')).toBeVisible();

    // Navigate to Export & Recovery
    await page.getByRole('link', { name: 'Export & Recovery', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Export & Recovery Workspace' })).toBeVisible();
    await expect(page.getByText(/Browser storage is not a permanent backup/i)).toBeVisible();

    // CSV download check (formula safety + comma quoting)
    const csvDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download CSV export/i }).click();
    const csvDownload = await csvDownloadPromise;
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await readFile(csvPath, 'utf8') : '';
    expect(csvContent).toContain("'=1+1");
    expect(csvContent).toContain('"2,4-dinitrophenol"');

    // Markdown download check
    await page.getByLabel('Output format').selectOption('md');
    const mdDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download MD export/i }).click();
    const mdDownload = await mdDownloadPromise;
    const mdPath = await mdDownload.path();
    const mdContent = mdPath ? await readFile(mdPath, 'utf8') : '';
    expect(mdContent).toContain('2,4-dinitrophenol');

    // TXT download check
    await page.getByLabel('Output format').selectOption('txt');
    const txtDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download TXT export/i }).click();
    const txtDownload = await txtDownloadPromise;
    const txtPath = await txtDownload.path();
    const txtContent = txtPath ? await readFile(txtPath, 'utf8') : '';
    expect(txtContent).toContain('2,4-dinitrophenol');

    // JSON presentation export download check
    await page.getByLabel('Output format').selectOption('json');
    const jsonDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download JSON export/i }).click();
    const jsonDownload = await jsonDownloadPromise;
    const jsonPath = await jsonDownload.path();
    const jsonContent = jsonPath ? await readFile(jsonPath, 'utf8') : '';
    const parsedPresentation = JSON.parse(jsonContent);
    expect(parsedPresentation.format).toBe('termforge-export');
    expect(parsedPresentation.version).toBe(1);

    // Download complete portable backup
    const backupDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download complete backup/i }).click();
    const backupDownload = await backupDownloadPromise;
    const backupPath = await backupDownload.path();
    const backupText = backupPath ? await readFile(backupPath, 'utf8') : '';
    const backupObj = JSON.parse(backupText);
    expect(backupObj.format).toBe('termforge-backup');
    expect(backupObj.snapshot.concepts).toHaveLength(2);

    // Invalid file (presentation export) must be rejected without mutating library
    await page.getByLabel(/Select portable backup file/i).setInputFiles({
      name: 'presentation-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(jsonContent, 'utf8'),
    });
    await expect(page.locator('main').getByRole('alert').first()).toContainText(
      /Backup validation \/ restore error/i,
    );

    // Valid backup file into NON-EMPTY target must show preview, and confirm must refuse overwrite
    await page.getByLabel(/Select portable backup file/i).setInputFiles({
      name: 'valid-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText, 'utf8'),
    });
    await expect(page.getByTestId('restore-preview')).toBeVisible();
    await page.getByRole('button', { name: /Confirm atomic restore/i }).click();
    await expect(page.locator('main').getByRole('alert').first()).toContainText(
      /CONFLICT|not empty|non-empty/i,
    );

    // Restore into a genuinely empty isolated browser context
    const emptyContext = await context.browser()!.newContext();
    const emptyPage = await emptyContext.newPage();
    await emptyPage.goto('/exchange');
    await emptyPage.getByLabel(/Select portable backup file/i).setInputFiles({
      name: 'valid-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupText, 'utf8'),
    });
    await expect(emptyPage.getByTestId('restore-preview')).toBeVisible();
    await emptyPage.getByRole('button', { name: /Confirm atomic restore/i }).click();
    await expect(emptyPage.getByText(/Restored validated backup atomically/i)).toBeVisible();

    await emptyPage.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(emptyPage.getByText('2,4-dinitrophenol')).toBeVisible();
    await expect(emptyPage.getByText('=1+1')).toBeVisible();
    await emptyContext.close();

    // No raw private content in URL or logs or external requests
    expect(page.url()).not.toContain('2,4-dinitrophenol');
    expect(consoleLogs.join('\n')).not.toContain('2,4-dinitrophenol');
    expect(
      requests.filter((r) => !r.startsWith('http://127.0.0.1:3100') && !r.startsWith('blob:')),
    ).toEqual([]);
  });
});
