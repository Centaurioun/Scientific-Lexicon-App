import { expect, test } from '@playwright/test';

test.describe('bilingual terminology library workspace (A5)', () => {
  test('starts genuinely empty, supports EN/TR concept creation, duplicate PD concepts, preview cancel, search, reload persistence, and keyboard error focus', async ({
    page,
  }) => {
    await page.goto('/library');

    // Genuine empty database state
    await expect(page.getByText('Your terminology library is empty')).toBeVisible();
    await expect(page.getByTestId('library-revision')).toContainText('Rev 0');

    // Invalid whitespace submission moves focus to text input and shows error
    await page.getByRole('button', { name: 'New concept' }).click();
    const initialTextInput = page.getByLabel('Initial expression text');
    await initialTextInput.fill('   ');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await expect(page.locator('main').getByRole('alert').first()).toContainText(/empty|whitespace/i);
    await expect(initialTextInput).toBeFocused();

    // Cancel preview leaves snapshot unchanged
    await initialTextInput.fill('TempCancelled');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await expect(page.getByRole('dialog', { name: 'Review and approve change' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('library-revision')).toContainText('Rev 0');
    await expect(page.getByText('Your terminology library is empty')).toBeVisible();

    // Create English-only TNF-α
    await page.getByRole('button', { name: 'New concept' }).click();
    await page.getByLabel('Initial expression text').fill('TNF-α');
    await page.getByLabel('Language', { exact: true }).selectOption('en');
    await page.getByLabel('Role', { exact: true }).selectOption('preferred');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await page.getByRole('button', { name: 'Approve and save' }).click();

    await expect(page.getByTestId('library-revision')).toContainText('Rev 1');
    await expect(page.getByText('TNF-α')).toBeVisible();

    // Add Turkish expression to TNF-α concept
    await page.getByRole('button', { name: /Add expression/i }).click();
    await page.getByLabel('Expression text').fill('tümör nekroz faktörü alfa');
    await page.getByLabel('Expression language').selectOption('tr');
    await page.getByLabel('Expression role').selectOption('preferred');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await page.getByRole('button', { name: 'Approve and save' }).click();

    await expect(page.getByTestId('library-revision')).toContainText('Rev 2');

    // Reload and verify persistence + search
    await page.reload();
    await expect(page.getByTestId('library-revision')).toContainText('Rev 2');
    await expect(page.getByText('TNF-α')).toBeVisible();
    await expect(page.getByText('tümör nekroz faktörü alfa')).toBeVisible();

    // Create two distinct concepts both having "PD"
    for (let i = 0; i < 2; i += 1) {
      await page.getByRole('button', { name: 'New concept' }).click();
      await page.getByLabel('Initial expression text').fill('PD');
      await page.getByLabel('Language', { exact: true }).selectOption('en');
      await page.getByLabel('Role', { exact: true }).selectOption('abbreviation');
      await page.getByRole('button', { name: 'Preview change' }).click();
      await page.getByRole('button', { name: 'Approve and save' }).click();
    }

    await page.getByLabel('Search expressions (case-sensitive)').fill('PD');
    await expect(page.getByTestId('expression-row')).toHaveCount(2);
  });

  test('detects stale edit from a second view and surfaces denied storage errors cleanly', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto('/library');
    await page2.goto('/library');

    // Both pages loaded at revision 0; page1 commits a concept -> revision 1
    await page1.getByRole('button', { name: 'New concept' }).click();
    await page1.getByLabel('Initial expression text').fill('IL-1');
    await page1.getByRole('button', { name: 'Preview change' }).click();
    await page1.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page1.getByTestId('library-revision')).toContainText('Rev 1');

    // page2 still holds revision 0 and attempts to save -> fails with stale error
    await page2.getByRole('button', { name: 'New concept' }).click();
    await page2.getByLabel('Initial expression text').fill('IL-11');
    await page2.getByRole('button', { name: 'Preview change' }).click();
    await page2.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page2.locator('main').getByRole('alert').first()).toContainText(/stale/i);

    // Denied IndexedDB shows explicit error and cannot save
    const deniedContext = await browser.newContext();
    const deniedPage = await deniedContext.newPage();
    await deniedPage.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        get() {
          throw new DOMException('Storage denied by policy', 'SecurityError');
        },
      });
    });
    await deniedPage.goto('/library');
    await expect(deniedPage.locator('main').getByRole('alert').first()).toContainText(
      /storage|indexeddb|unavailable|denied/i,
    );
    await expect(deniedPage.getByRole('button', { name: 'New concept' })).toBeDisabled();

    await context.close();
    await deniedContext.close();
  });
});
