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

test('clearing an active dictionary pack invalidates an overlapping delayed upload', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'slow-pack.json') return original.call(this);
      return new Promise<ArrayBuffer>((resolve, reject) => {
        window.setTimeout(() => original.call(this).then(resolve, reject), 300);
      });
    };
  });

  const pack = (id: string, name: string) => JSON.stringify({
    format: 'termforge-dictionary-pack',
    version: 1,
    id,
    name,
    source: {
      authority: 'Synthetic fixture',
      uri: 'https://example.invalid/synthetic-pack',
      release: 'fixture-v1',
      license: 'synthetic-only',
    },
    entries: [{ id: `${id}-entry`, text: 'Na+/K+-ATPase', language: { kind: 'shared' } }],
  });

  await page.goto('/extraction');
  const input = page.locator('#dictionary-pack-input');
  await input.setInputFiles({
    name: 'first-pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(pack('synthetic-pack-one', 'First synthetic pack')),
  });
  await expect(page.locator('main')).toContainText('First synthetic pack');

  await input.setInputFiles({
    name: 'slow-pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(pack('synthetic-pack-two', 'Delayed synthetic pack')),
  });
  await page.getByRole('button', { name: 'Clear pack' }).click();
  await page.waitForTimeout(350);

  await expect(page.locator('main')).not.toContainText('Active session pack:');
  await expect(page.locator('main')).not.toContainText('Delayed synthetic pack');
});
