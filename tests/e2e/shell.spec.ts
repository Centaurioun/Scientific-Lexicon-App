import { expect, test } from '@playwright/test';

test('starter exposes only the initial setup state and sends no document data', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'TermForge', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Library setup', exact: true })).toBeVisible();
  await expect(page.getByText(/library and its local storage will be created as WP01 is implemented/i)).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  expect(requests.some((request) => request.includes('TERMFORGE_SYNTHETIC_DOCUMENT_MARKER'))).toBe(false);
  expect(requests.filter((request) => !request.startsWith('http://127.0.0.1:3100'))).toEqual([]);
});
