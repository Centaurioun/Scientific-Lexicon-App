import { expect, test } from '@playwright/test';

test.describe('WP02 D9: Terminology lookup modes and concept navigation', () => {
  test('distinguishes literal case-sensitive lookup from opt-in case-insensitive view without altering stored case', async ({
    page,
  }) => {
    await page.goto('/library');

    // Create p53 concept
    await page.getByRole('button', { name: 'New concept' }).click();
    await page.locator('#editor-text-input').fill('p53');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await page.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page.getByTestId('library-revision')).toContainText('Rev 1');

    // Create P53 concept
    await page.getByRole('button', { name: 'New concept' }).click();
    await page.locator('#editor-text-input').fill('P53');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await page.getByRole('button', { name: 'Approve and save' }).click();
    await expect(page.getByTestId('library-revision')).toContainText('Rev 2');

    // Default literal substring finds only p53
    await page.locator('#library-search').fill('p53');
    await expect(page.getByTestId('expression-row')).toHaveCount(1);

    // Opt-in case-insensitive view finds both without changing Rev 2 or stored text
    await page.locator('#library-lookup-mode').selectOption('case-insensitive-view');
    await expect(page.getByTestId('expression-row')).toHaveCount(2);
    await expect(page.getByTestId('library-revision')).toContainText('Rev 2');
  });
});
