import { expect, test } from '@playwright/test';

test('application shell exposes only implemented WP01 workspaces and sends no document data', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'TermForge', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('href', '/library');
  await expect(page.getByRole('link', { name: 'Extraction', exact: true })).toHaveAttribute('href', '/extraction');
  await expect(page.getByRole('link', { name: 'Export & Recovery', exact: true })).toHaveAttribute('href', '/exchange');

  // Ensure no unimplemented S2–S7 routes exist in links
  const hrefs = await page.getByRole('link').evaluateAll((els) =>
    els.map((el) => el.getAttribute('href') ?? ''),
  );
  for (const href of hrefs) {
    expect(['/', '/library', '/extraction', '/exchange']).toContain(href);
  }

  expect(requests.some((request) => request.includes('TERMFORGE_SYNTHETIC_DOCUMENT_MARKER'))).toBe(false);
  expect(requests.filter((request) => !request.startsWith('http://127.0.0.1:3100'))).toEqual([]);
});

