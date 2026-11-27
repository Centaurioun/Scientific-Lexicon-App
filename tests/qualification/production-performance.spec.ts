import { expect, test, type Page } from '@playwright/test';

type FrameProbe = { start: number; last: number; max: number; sum: number; count: number; id: number };
type ProbeWindow = Window & { __qualificationFrameProbe?: FrameProbe };

async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as ProbeWindow;
    const now = performance.now();
    const p: FrameProbe = { start: now, last: now, max: 0, sum: 0, count: 0, id: 0 };
    const frame = (t: number) => {
      const gap = Math.max(0, t - p.last);
      p.last = t;
      p.max = Math.max(p.max, gap);
      p.sum += gap;
      p.count++;
      p.id = requestAnimationFrame(frame);
    };
    w.__qualificationFrameProbe = p;
    p.id = requestAnimationFrame(frame);
  });
}

async function finishProbe(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const w = window as ProbeWindow;
    const p = w.__qualificationFrameProbe;
    if (!p) throw new Error('Missing frame probe');
    cancelAnimationFrame(p.id);
    delete w.__qualificationFrameProbe;
    return {
      elapsedMs: performance.now() - p.start,
      rafMaxMs: p.max,
      rafAvgMs: p.count ? p.sum / p.count : null,
      frames: p.count,
      heapUsedBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    };
  });
}

for (const count of [5_000, 10_000]) {
  test(`production: ${count} repeated synthetic spans, complete output and responsiveness`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.goto('/extraction');
    await expect(page.getByLabel('Maximum candidate occurrences')).toHaveValue('5000');
    if (count === 10_000) {
      await page.getByLabel('Maximum candidate occurrences').fill('10000');
      await page.getByRole('button', { name: 'Save processing limits' }).click();
      await expect(page.getByRole('status')).toContainText(/processing limits saved/i);
    }
    await page.getByLabel('English scientific source text').fill('CD4+. '.repeat(count));
    const rows = page.getByTestId('candidate-row');
    await startProbe(page);
    await page.getByRole('button', { name: 'Analyze locally' }).click();
    await expect(page.getByTestId('occurrence-total')).toHaveText(String(count), { timeout: 90_000 });
    await expect(rows).toHaveCount(count, { timeout: 90_000 });
    const analysisAndRender = await finishProbe(page);
    await expect(rows.first()).toContainText('CD4+');
    await expect(rows.last()).toContainText('CD4+');
    await startProbe(page);
    await page.locator('#rank-mode-select').selectOption('c-value');
    await expect(rows).toHaveCount(count, { timeout: 90_000 });
    const cValueSwitch = await finishProbe(page);
    await expect(page.getByTestId('header-revision')).toContainText('Rev 0');
    const evidence = { scenario: 'S1 repeated synthetic', count, analysisAndRender, cValueSwitch, browser: await page.evaluate(() => navigator.userAgent), note: 'Production observations; includes browser automation/frame sampling overhead. No latency threshold.' };
    console.log('QUALIFICATION_PRODUCTION=' + JSON.stringify(evidence));
    await testInfo.attach('production-observation', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  });
}
