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

    // Tab A applies first -> Rev 1
    await tabA.getByRole('button', { name: 'Approve and save' }).click();
    await expect(tabA.getByText('CD4+')).toBeVisible();

    // Tab B now attempts to apply its stale Rev 0 proposal -> must fail closed as STALE
    await tabB.getByRole('button', { name: 'Approve and save' }).click();
    await expect(tabB.locator('main').getByRole('alert').first()).toContainText(/stale/i);

    // Reload Tab B and verify Tab A's committed record is intact and Tab B's stale record was NOT written
    await tabB.reload();
    await expect(tabB.getByText('CD4+')).toBeVisible();
    await expect(tabB.getByText('IL-6')).toHaveCount(0);
  });

  test('displays explicit browser storage persistence status and origin-isolation warning', async ({
    page,
  }) => {
    await page.goto('/exchange');
    await expect(page.getByText(/Browser storage is not a permanent backup/i)).toBeVisible();
    await expect(page.getByTestId('storage-persisted')).toBeVisible();
  });
});
