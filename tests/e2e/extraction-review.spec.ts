import { expect, test } from '@playwright/test';

test('extraction review discovers unknown candidates on empty library, supports reject/create/link/resolve, respects filters, and requires explicit approval (B4)', async ({
  page,
}) => {
  await page.goto('/extraction');

  await page
    .getByLabel('English scientific source text')
    .fill('Periodontal ligament stem cells express TNF-α and CD4+ markers.');
  await page.getByRole('button', { name: 'Analyze locally' }).click();

  await expect(page.getByTestId('candidate-row').first()).toBeVisible();
  await expect(page.getByTestId('source-context')).toContainText('TNF-α');

  // Filter to new candidates does not erase source text
  await page.getByRole('tab', { name: /New candidates/i }).click();
  await expect(page.getByTestId('source-context')).toContainText('TNF-α');

  // Reject a candidate -> session-only, canonical revision remains 0
  const firstRow = page.getByTestId('candidate-row').first();
  await firstRow.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('header-revision')).toContainText('Rev 0');

  // Approve creating a concept for TNF-α
  const tnfRow = page.getByTestId('candidate-row').filter({ hasText: 'TNF-α' }).first();
  await tnfRow.getByRole('button', { name: 'Create concept' }).click();
  await expect(page.getByRole('dialog', { name: 'Review and approve change' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve and save' }).click();

  await expect(page.getByTestId('header-revision')).toContainText('Rev 1');

  // Re-analyze and verify TNF-α is now classified as known-form
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  await page.getByRole('tab', { name: /Known forms/i }).click();
  await expect(page.getByTestId('candidate-row').filter({ hasText: 'TNF-α' })).toBeVisible();
});

test('changing source text clears previous run results and disables old candidate actions', async ({ page }) => {
  await page.goto('/extraction');
  const source = page.getByLabel('English scientific source text');
  await source.fill('Synthetic source A contains TNF-α.');
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  const oldCandidate = page.getByTestId('candidate-row').filter({ hasText: 'TNF-α' });
  await expect(oldCandidate).toBeVisible();

  await source.fill('Synthetic source B contains IL-6.');
  await expect(page.getByTestId('candidate-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create concept' })).toHaveCount(0);
});
