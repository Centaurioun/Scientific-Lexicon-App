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

test('rejects arbitrary schema-valid and tampered dictionary packs in UI without bypass (QC01)', async ({
  page,
}) => {
  await page.goto('/extraction');
  const input = page.locator('#dictionary-pack-input');

  const arbitrary = JSON.stringify({
    format: 'termforge-dictionary-pack',
    version: 1,
    id: 'unapproved-external-pack',
    name: 'Unapproved Schema-Valid Pack',
    source: {
      authority: 'Synthetic fixture',
      uri: 'https://example.invalid/synthetic-pack',
      release: 'fixture-v1',
      license: 'synthetic-only',
    },
    entries: [{ id: 'u-1', text: 'TNF-α', language: { kind: 'shared' } }],
  });

  await input.setInputFiles({
    name: 'pack-synth-bio-v1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(arbitrary),
  });
  await expect(page.locator('main').getByRole('alert')).toContainText(/not in the approved WP02 synthetic fixture allowlist/i);
  await expect(page.locator('main')).not.toContainText('Active session pack:');

  const tamperedAllowlisted = JSON.stringify({
    format: 'termforge-dictionary-pack',
    version: 1,
    id: 'synthetic-pack-one',
    name: 'First synthetic pack',
    source: {
      authority: 'Synthetic fixture',
      uri: 'https://example.invalid/synthetic-pack',
      release: 'fixture-v1',
      license: 'synthetic-only',
    },
    entries: [{ id: 'synthetic-pack-one-entry', text: 'TAMPERED-TERM', language: { kind: 'shared' } }],
  });

  await input.setInputFiles({
    name: 'synthetic-pack-one.json',
    mimeType: 'application/json',
    buffer: Buffer.from(tamperedAllowlisted),
  });
  await expect(page.locator('main').getByRole('alert')).toContainText(/failed exact SHA-256 content digest verification/i);
  await expect(page.locator('main')).not.toContainText('Active session pack:');
});

test('supports keyboard-only tablist navigation, Escape modal dismissal with focus restoration, and grouped/flat review actions (QC05)', async ({
  page,
}) => {
  await page.goto('/extraction');
  await page.locator('#source-text-area').fill(
    'Periodontal ligament-derived stem cells express TNF-α and Na+/K+-ATPase. Periodontal ligament-derived stem cells respond to TNF-α.',
  );
  await page.locator('#grammar-mode-select').selectOption('s2-grammar-2');
  await page.getByRole('button', { name: 'Analyze locally' }).click();

  await expect(page.getByTestId('candidate-row').first()).toBeVisible();

  // Keyboard navigation across candidate filter tablist
  const allTab = page.getByRole('tab', { name: /^All/ });
  await allTab.focus();
  await page.keyboard.press('ArrowRight');
  const newCandTab = page.getByRole('tab', { name: /^New candidates/ });
  await expect(newCandTab).toHaveAttribute('aria-selected', 'true');
  await expect(newCandTab).toBeFocused();
  await page.keyboard.press('Home');
  await expect(allTab).toHaveAttribute('aria-selected', 'true');

  // Toggle C-value + Grouped view and trigger approval modal, then dismiss with Escape & verify focus restores
  await page.locator('#rank-mode-select').selectOption('c-value');
  await page.locator('#grouped-view-toggle').check();
  const createBtn = page.getByRole('button', { name: 'Create concept' }).first();
  await createBtn.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(createBtn).toBeFocused();
});

