import { expect, test } from '@playwright/test';

test('session-only extraction leaks no raw marker, explicit consent retains source, and deletion clears source/runs/pointers while preserving concepts (B5)', async ({
  page,
}) => {
  const MARKER = 'PRIVATE-SYNTHETIC-123';
  const networkPayloads: string[] = [];
  const consoleMessages: string[] = [];

  page.on('request', (req) => networkPayloads.push(`${req.url()} ${req.postData() ?? ''}`));
  page.on('console', (msg) => consoleMessages.push(msg.text()));

  await page.goto('/extraction');
  await page
    .getByLabel('English scientific source text')
    .fill(`Patient note ${MARKER} reports elevated TNF-α levels.`);
  await page.getByRole('button', { name: 'Analyze locally' }).click();

  // Save concept only in default session-only mode
  const tnfRow = page.getByTestId('candidate-row').filter({ hasText: 'TNF-α' }).first();
  await tnfRow.getByRole('button', { name: 'Create concept' }).click();
  await page.getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByTestId('header-revision')).toContainText('Rev 1');

  // Reload clears session-only input
  await page.reload();
  await expect(page.getByLabel('English scientific source text')).toHaveValue('');

  // Verify zero leakage of MARKER in console or network
  expect(networkPayloads.some((p) => p.includes(MARKER))).toBe(false);
  expect(consoleMessages.some((m) => m.includes(MARKER))).toBe(false);

  // Explicit opt-in retention
  await page
    .getByLabel('English scientific source text')
    .fill(`Retained note ${MARKER} confirms TNF-α signal.`);
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  await page.getByLabel('Source title for local retention').fill('Synthetic Retain Case');
  await page
    .getByLabel(/I explicitly consent to retain this source text locally in browser IndexedDB/i)
    .check();
  await page.getByRole('button', { name: 'Retain source locally' }).click();
  await page.getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByText('Synthetic Retain Case')).toBeVisible();

  // Explicit deletion of retained source removes document/runs while preserving concept
  await page.getByRole('button', { name: /Delete retained source Synthetic Retain Case/i }).click();
  await page.getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByText('Synthetic Retain Case')).toHaveCount(0);

  // Concept TNF-α survives in library
  await page.goto('/library');
  await expect(page.getByText('TNF-α')).toBeVisible();
});
