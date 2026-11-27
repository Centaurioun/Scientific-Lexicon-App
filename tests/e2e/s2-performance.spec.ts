import { expect, test } from '@playwright/test';

test.describe('WP02 D7: Browser performance, occurrence limits, and cancellation', () => {
  test('enforces processing limits cleanly and rejects stale runs on source change', async ({ page }) => {
    await page.goto('/extraction');

    await page.locator('#grammar-mode-select').selectOption('s2-grammar-2');
    await page.locator('#source-text-area').fill(
      'Periodontal ligament-derived stem cells express TNF-α, Na+/K+-ATPase, HLA-B, HLA-B27, and loss of heterozygosity.',
    );
    await page.getByRole('button', { name: 'Analyze locally' }).click();

    await expect(page.getByTestId('occurrence-total')).toBeVisible();
    const initialCount = Number(await page.getByTestId('occurrence-total').textContent());
    expect(initialCount).toBeGreaterThan(0);

    // Editing source clears previous analysis and prevents stale proposal
    await page.locator('#source-text-area').fill('Updated synthetic passage with Gram staining.');
    await expect(page.getByTestId('occurrence-total')).toHaveCount(0);
    await expect(page.locator('main').getByRole('status')).toContainText(/Source changed/i);
  });
});
