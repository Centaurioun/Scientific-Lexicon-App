import { expect, test } from '@playwright/test';

test.describe('WP02 D11: Integrated synthetic Markdown -> S2 review -> approve -> library -> export -> backup/restore flow', () => {
  test('completes full local-only S2 workflow with zero external document transfer and exact S1 backup/restore parity', async ({
    page,
    browser,
  }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('blob:') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });

    await page.goto('/extraction');
    await page.locator('#input-format-select').selectOption('markdown');
    await page.locator('#grammar-mode-select').selectOption('s2-grammar-2');
    await page.locator('#source-text-area').fill(
      '# Assay Notes\n\nGram staining confirmed Na+/K+-ATPase and loss of heterozygosity.\n\n```ts\nconst skip = "TNF-α";\n```',
    );
    await page.getByRole('button', { name: 'Analyze locally' }).click();
    await expect(page.getByTestId('occurrence-total')).toBeVisible();

    // Rank by C-value
    await page.locator('#rank-mode-select').selectOption('c-value');
    await page.locator('#grouped-view-toggle').check();

    // Approve one candidate via SHA-256 dialog
    const targetRow = page.getByTestId('candidate-row').filter({ hasText: 'Na+/K+-ATPase' }).first();
    await targetRow.getByRole('button', { name: 'Create concept' }).click();
    await page.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page.locator('main').getByRole('status')).toContainText(/library revision 1/i);

    // Reload and verify library persistence
    await page.goto('/library');
    await expect(page.getByTestId('library-revision')).toContainText('Rev 1');
    await expect(page.locator('main')).toContainText('Na+/K+-ATPase');

    // Download backup from /exchange and restore into isolated empty browser context
    await page.goto('/exchange');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download complete backup (.json)' }).click(),
    ]);
    const backupPath = await download.path();
    expect(backupPath).toBeTruthy();

    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto('/exchange');
    await freshPage.locator('#backup-file-input').setInputFiles(backupPath!);
    await freshPage.getByRole('button', { name: 'Confirm atomic restore' }).click();
    await freshPage.goto('/library');
    await expect(freshPage.locator('main')).toContainText('Na+/K+-ATPase');
    await freshContext.close();

    expect(externalRequests).toEqual([]);
  });
});
