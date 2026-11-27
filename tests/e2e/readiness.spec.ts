import { expect, test } from '@playwright/test';

test.describe('C5 / G4: Real-data readiness probes (separate from G3)', () => {
  test('two simultaneous tabs with conflicting revision writes: one applies, one fails closed as stale without data loss', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    await tabA.goto('/library');
    await tabB.goto('/library');
    await expect(tabA.getByText(/Your terminology library is empty/i)).toBeVisible();
    await expect(tabB.getByText(/Your terminology library is empty/i)).toBeVisible();

    // Both tabs prepare a Rev 0 -> Rev 1 write simultaneously
    await tabA.getByRole('button', { name: 'New concept' }).click();
    await tabA.getByLabel('Initial expression text').fill('CD4+');
    await tabA.getByRole('button', { name: 'Preview change' }).click();
    await expect(tabA.getByRole('dialog')).toBeVisible();

    await tabB.getByRole('button', { name: 'New concept' }).click();
    await tabB.getByLabel('Initial expression text').fill('IL-6');
    await tabB.getByRole('button', { name: 'Preview change' }).click();
    await expect(tabB.getByRole('dialog')).toBeVisible();

    // Submit both approvals concurrently from separate tabs. Which transaction
    // wins is intentionally unspecified; the loser must fail closed as stale.
    await Promise.all([
      tabA.getByRole('button', { name: 'Approve and save' }).click(),
      tabB.getByRole('button', { name: 'Approve and save' }).click(),
    ]);
    await Promise.all([
      expect(tabA.getByRole('dialog', { name: 'Review and approve change' })).toBeHidden(),
      expect(tabB.getByRole('dialog', { name: 'Review and approve change' })).toBeHidden(),
    ]);
    await expect.poll(async () => {
      const staleAlerts = await Promise.all([
        tabA.locator('main').getByRole('alert').allTextContents(),
        tabB.locator('main').getByRole('alert').allTextContents(),
      ]);
      return staleAlerts.flat().filter((text) => /stale/i.test(text)).length;
    }).toBe(1);

    // Both tabs must converge on the one committed record after reload.
    await Promise.all([tabA.reload(), tabB.reload()]);
    await Promise.all([
      expect(tabA.getByTestId('library-revision')).toContainText('Rev 1'),
      expect(tabB.getByTestId('library-revision')).toContainText('Rev 1'),
    ]);
    const visibleCounts = await Promise.all([
      tabA.getByText('CD4+', { exact: true }).count(),
      tabA.getByText('IL-6', { exact: true }).count(),
    ]);
    expect(visibleCounts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await tabB.getByText('CD4+', { exact: true }).count()).toBe(visibleCounts[0]);
    expect(await tabB.getByText('IL-6', { exact: true }).count()).toBe(visibleCounts[1]);
  });

  test('displays explicit browser storage persistence status and origin-isolation warning', async ({
    page,
  }) => {
    await page.goto('/exchange');
    await expect(page.getByText(/Browser storage is not a permanent backup/i)).toBeVisible();
    await expect(page.getByTestId('storage-persisted')).toBeVisible();
  });
});
