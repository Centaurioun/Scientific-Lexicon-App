import { expect, test } from '@playwright/test';
import { PROCESSING_LIMITS_STORAGE_KEY } from '../../src/features/extraction/processing-limits-store';

test('processing preferences bound the unified run and rejected analyses expose no partial results', async ({ page }) => {
  await page.goto('/extraction');
  await expect(page.getByRole('heading', { name: 'Processing limits' })).toBeVisible();
  await expect(page.getByLabel('Maximum candidate occurrences')).toHaveValue('5000');

  await page.getByLabel('Maximum candidate occurrences').fill('100');
  await page.getByRole('button', { name: 'Save processing limits' }).click();
  await expect(page.getByRole('status')).toContainText(/processing limits saved/i);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), PROCESSING_LIMITS_STORAGE_KEY);
  expect(saved.maxCandidateOccurrences).toBe(100);

  const source = page.getByLabel('English scientific source text');
  await source.fill('CD4+. '.repeat(100));
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  await expect(page.getByTestId('occurrence-total')).toHaveText('100');
  await expect(page.getByTestId('candidate-row')).toHaveCount(100);

  await source.fill('CD4+. '.repeat(101));
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(/exceeded.*100.*distinct occurrence spans/i);
  await expect(page.getByTestId('candidate-row')).toHaveCount(0);
  await expect(page.getByTestId('occurrence-total')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create concept' })).toHaveCount(0);
  await expect(page.getByTestId('header-revision')).toContainText('Rev 0');
});

test('the default 5,000 occurrence ceiling renders a complete bounded synthetic run', async ({ page }) => {
  await page.goto('/extraction');
  const source = page.getByLabel('English scientific source text');
  await source.fill('CD4+. '.repeat(5_000));
  const startedAt = Date.now();
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  await expect(page.getByTestId('occurrence-total')).toHaveText('5000', { timeout: 60_000 });
  const analysisMs = Date.now() - startedAt;
  const rowRenderStartedAt = Date.now();
  await expect(page.getByTestId('candidate-row')).toHaveCount(5_000, { timeout: 60_000 });
  const rowRenderMs = Date.now() - rowRenderStartedAt;
  console.info(`Synthetic 5,000-occurrence UI: analysis ${analysisMs} ms; 5,000 rows visible ${rowRenderMs} ms after count update`);
  await expect(page.getByRole('button', { name: /Cancel analysis/i })).toHaveCount(0);
  await expect(page.getByTestId('header-revision')).toContainText('Rev 0');
});

test('the provisional 10,000 hard ceiling is configurable and renders without truncation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/extraction');
  await page.getByLabel('Maximum candidate occurrences').fill('10000');
  await page.getByRole('button', { name: 'Save processing limits' }).click();
  await expect(page.getByRole('status')).toContainText(/processing limits saved/i);
  await page.getByLabel('English scientific source text').fill('CD4+. '.repeat(10_000));
  const startedAt = Date.now();
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  await expect(page.getByTestId('occurrence-total')).toHaveText('10000', { timeout: 90_000 });
  const analysisMs = Date.now() - startedAt;
  const rowRenderStartedAt = Date.now();
  await expect(page.getByTestId('candidate-row')).toHaveCount(10_000, { timeout: 90_000 });
  const rowRenderMs = Date.now() - rowRenderStartedAt;
  console.info(`Synthetic 10,000-occurrence UI: analysis ${analysisMs} ms; 10,000 rows visible ${rowRenderMs} ms after count update`);
  await expect(page.getByTestId('header-revision')).toContainText('Rev 0');
});

test('cancellation during bounded analysis leaves no actionable partial run', async ({ page }) => {
  await page.goto('/extraction');
  await page.getByLabel('English scientific source text').fill('CD4+. '.repeat(30_000));
  await page.getByRole('button', { name: 'Analyze locally' }).click();
  await page.getByRole('button', { name: 'Cancel analysis' }).click();
  await expect(page.getByRole('status')).toContainText(/cancelled/i);
  await expect(page.getByTestId('occurrence-total')).toHaveCount(0);
  await expect(page.getByTestId('candidate-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create concept' })).toHaveCount(0);
  await expect(page.getByTestId('header-revision')).toContainText('Rev 0');
});
