import { expect, test } from '@playwright/test';

test.describe('WP02 D8: Scientific review, Markdown input, grammar switcher, C-value ranking, and dictionary pack hints', () => {
  test('supports Markdown exclusions, S1 vs S2 switch, C-value grouped view, and session-only dictionary pack hints without DB writes', async ({
    page,
  }) => {
    await page.goto('/extraction');

    // Switch to Markdown + S2 experimental grammar
    await page.locator('#input-format-select').selectOption('markdown');
    await page.locator('#grammar-mode-select').selectOption('s2-grammar-2');

    const md = [
      '# Inflammatory Signaling',
      '',
      'Tumor necrosis factor alpha (TNF-α) and periodontal ligament-derived stem cells show loss of heterozygosity (LOH).',
      'Periodontal ligament-derived stem cells and stem cells appear repeatedly; `TNF-α` inside inline code is ignored.',
      '',
      '```ts',
      'const ignored = "HLA-B27";',
      '```',
    ].join('\n');

    await page.locator('#source-text-area').fill(md);
    await page.getByRole('button', { name: 'Analyze locally' }).click();

    await expect(page.getByTestId('occurrence-total')).toBeVisible();
    await expect(page.locator('main')).toContainText('s2-grammar-2+s1-boundary-v1');
    await expect(page.locator('main')).toContainText('md-conservative-v1');
    // Code-fence term excluded
    await expect(page.getByTestId('candidate-row').filter({ hasText: 'HLA-B27' })).toHaveCount(0);
    // Scientific evidence & hypothesis-only label visible
    await expect(page.locator('main')).toContainText(/Hypothesis only/i);

    // Switch ranking to C-value and enable grouped view (display-only, no DB write)
    await page.locator('#rank-mode-select').selectOption('c-value');
    await page.locator('#grouped-view-toggle').check();
    await expect(page.getByTestId('grouped-candidate-list')).toBeVisible();
    await expect(page.getByTestId('ranked-group-card').first()).toContainText(/C-value|Unigram/);
  });
});
