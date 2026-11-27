import { expect, test } from '@playwright/test';

test('out-of-order document reads cannot replace the newest selected source', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      const delay = this.name === 'slow.md' ? 300 : 0;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        window.setTimeout(() => original.call(this).then(resolve, reject), delay);
      });
    };
  });

  await page.goto('/extraction');
  const input = page.locator('#txt-file-input');
  await input.setInputFiles({
    name: 'slow.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Old source\n\nperiodontal ligament'),
  });
  await input.setInputFiles({
    name: 'newest.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Newest source\n\nGram staining'),
  });

  await expect(page.locator('#source-text-area')).toHaveValue('# Newest source\n\nGram staining');
  await expect(page.locator('main').getByRole('status')).toContainText('newest.md');
  await page.waitForTimeout(350);
  await expect(page.locator('#source-text-area')).toHaveValue('# Newest source\n\nGram staining');
});
