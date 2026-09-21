import { expect, test, type Page } from '@playwright/test';

const SAMPLE_OUTLIERS = ['P04', 'P10'];
const EXPECTED_MATRIX = ['300', '100', '10000', '100', '400', '20000', '1', '2', '1000'];

async function runSampleAudit(page: Page, limit = '2') {
  await page.getByTestId('btn-sample').click();
  await expect(page.getByTestId('input-points')).not.toHaveValue('');
  await page.getByTestId('input-limit').fill(limit);
  await page.getByTestId('btn-run').click();
  await expect(page.getByTestId('notice-success')).toBeVisible();
}

test.describe('glass-plate homography audit', () => {
  test('sample batch: exact matrix, partition, counts and SVG overlay evidence', async ({ page }, testInfo) => {
    const origin = testInfo.project.use.baseURL as string;
    const external: string[] = [];
    page.on('request', (req) => {
      if (!req.url().startsWith(origin)) external.push(req.url());
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/射影配准审计/);

    await runSampleAudit(page);

    // Counts and ceiling.
    await expect(page.getByTestId('inlier-count')).toHaveText('10');
    await expect(page.getByTestId('outlier-count')).toHaveText('2');
    await expect(page.getByTestId('distinct-count')).toHaveText('1');
    const frames = Number((await page.getByTestId('frames-count').textContent()) ?? '0');
    expect(frames).toBeGreaterThan(0);

    // Canonical nine-integer matrix, row-major (display uses thousands separators).
    for (let i = 0; i < 9; i++) {
      const cell = page.locator(`[data-testid=matrix] [data-pos="${Math.floor(i / 3)}${i % 3}"]`);
      expect((await cell.textContent())?.replace(/,/g, '')).toBe(EXPECTED_MATRIX[i]);
    }

    // Retained / removed identifiers.
    const inChips = await page.getByTestId('inlier-list').locator('.chip').allTextContents();
    const outChips = await page.getByTestId('outlier-list').locator('.chip').allTextContents();
    expect(inChips).toHaveLength(10);
    expect(outChips.sort()).toEqual([...SAMPLE_OUTLIERS]);
    expect(inChips).not.toContain(SAMPLE_OUTLIERS[0]);

    // SVG overlay: coincident points, outliers, residual lines, projections.
    await expect(page.locator('svg .mk-inlier')).toHaveCount(10);
    await expect(page.locator('svg .mk-outlier')).toHaveCount(2);
    await expect(page.locator('svg .ln-residual')).toHaveCount(2);
    await expect(page.locator('svg .mk-proj')).toHaveCount(2);

    // Per-point exact verification table.
    for (const id of inChips) {
      await expect(page.getByTestId(`verdict-${id}`)).toHaveText('保留·精确重合');
    }
    for (const id of SAMPLE_OUTLIERS) {
      await expect(page.getByTestId(`verdict-${id}`)).toHaveText('剔除·离群');
    }

    // The page must not contact any non-local origin (browser-only requirement).
    expect(external).toEqual([]);
  });

  test('orientation-reversing projectivity batch: zero-outlier success via real paste', async ({ page }) => {
    await page.goto('/');

    const batch = [
      'P1, 0, 1, 0, 1',
      'P2, 1, 1, 1, 1',
      'P3, 2, 1, 2, 1',
      'P4, 3, 1, 3, 1',
      'N1, 10, -1, -10, -1',
      'N2, 11, -1, -11, -1',
      'N3, 12, -1, -12, -1',
      'N4, 13, -1, -13, -1',
    ].join('\n');
    const allIds = ['P1', 'P2', 'P3', 'P4', 'N1', 'N2', 'N3', 'N4'];

    // Real browser operations: paste, set the outlier ceiling, run the audit.
    await page.getByTestId('input-points').fill(batch);
    await page.getByTestId('input-limit').fill('0');
    await page.getByTestId('btn-run').click();

    await expect(page.getByTestId('notice-success')).toBeVisible();
    await expect(page.getByTestId('notice-failure')).toHaveCount(0);

    // Counts, partition and distinct optimal transforms.
    await expect(page.getByTestId('inlier-count')).toHaveText('8');
    await expect(page.getByTestId('outlier-count')).toHaveText('0');
    await expect(page.getByTestId('distinct-count')).toHaveText('1');

    const inChips = await page.getByTestId('inlier-list').locator('.chip').allTextContents();
    expect(inChips).toEqual(allIds);
    const outBox = page.getByTestId('outlier-list');
    await expect(outBox.locator('.chip')).toHaveCount(0);
    await expect(outBox).toContainText('无');

    // Canonical nine-integer matrix: 1,0,0 / 0,0,1 / 0,1,0.
    const expected = ['1', '0', '0', '0', '0', '1', '0', '1', '0'];
    for (let i = 0; i < 9; i++) {
      const cell = page.locator(`[data-testid=matrix] [data-pos="${Math.floor(i / 3)}${i % 3}"]`);
      expect((await cell.textContent())?.trim()).toBe(expected[i]);
    }

    // Per-point table: every correspondence retained with exact coincidence.
    for (const id of allIds) {
      await expect(page.getByTestId(`verdict-${id}`)).toHaveText('保留·精确重合');
    }

    // SVG overlay evidence: exactly eight coincident points, no outlier marks.
    await expect(page.locator('svg .mk-inlier')).toHaveCount(8);
    await expect(page.locator('svg .mk-outlier')).toHaveCount(0);
    await expect(page.locator('svg .ln-residual')).toHaveCount(0);
  });

  test('ceiling exceeded: failure reason shown, input retained, old figure cleared', async ({ page }) => {
    await page.goto('/');
    await runSampleAudit(page);
    await expect(page.getByTestId('result-panel')).toBeVisible();

    // Tighten the ceiling below the true minimum of 2.
    await page.getByTestId('input-limit').fill('0');
    const typed = await page.getByTestId('input-points').inputValue();
    await page.getByTestId('btn-run').click();

    const failure = page.getByTestId('notice-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(/离群/);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    // Input preserved verbatim.
    await expect(page.getByTestId('input-points')).toHaveValue(typed);

    // Re-running with the correct ceiling restores the successful figure.
    await page.getByTestId('input-limit').fill('2');
    await page.getByTestId('btn-run').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.getByTestId('outlier-count')).toHaveText('2');
  });

  test('no four-point frame: failure with retained input and cleared figure', async ({ page }) => {
    await page.goto('/');
    await runSampleAudit(page);
    await expect(page.locator('svg .mk-inlier')).toHaveCount(10);

    // Eight distinct points all collinear on side A: no projective frame exists.
    const collinear = Array.from({ length: 8 }, (_, i) => `P${i}, ${i}, 0, ${i + 3}, ${i * i + 1}`).join('\n');
    await page.getByTestId('input-points').fill(collinear);
    await page.getByTestId('input-limit').fill('4');
    await page.getByTestId('btn-run').click();

    await expect(page.getByTestId('notice-failure')).toContainText(/标架/);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    await expect(page.locator('svg')).toHaveCount(0);
    await expect(page.getByTestId('input-points')).toHaveValue(collinear);
  });

  test('malformed input is rejected and never produces a figure', async ({ page }) => {
    await page.goto('/');
    const bad = [
      'P0, 0, 0, 1, 1',
      'P0, 1, 0, 2, 1', // duplicate identifier
      'P1, 0, 1, 1, 2',
      'P2, 2, 2, 3, 3',
      'P3, 3, 4, 4, 5',
      'P4, 4, 5, 5, 6',
      'P5, 5, 6, 6, 7',
      'P6, 6, 7, 7, 8',
    ].join('\n');
    await page.getByTestId('input-points').fill(bad);
    await page.getByTestId('btn-run').click();
    await expect(page.getByTestId('notice-error')).toContainText(/标识重复/);
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
  });

  test('editing a point and re-auditing updates the exact verdict live', async ({ page }) => {
    await page.goto('/');
    await runSampleAudit(page);
    await expect(page.getByTestId('verdict-P01')).toHaveText('保留·精确重合');

    // Corrupt P01's B-side mark by one unit via the editor; minimum outliers
    // becomes 3 which exceeds ceiling 2.
    const text = await page.getByTestId('input-points').inputValue();
    const edited = text.replace(/^P01,(\s*-?\d+),(\s*-?\d+),(\s*-?\d+),/m, 'P01,$1,$2,999,');
    expect(edited).not.toBe(text);
    await page.getByTestId('input-points').fill(edited);
    await page.getByTestId('btn-run').click();
    await expect(page.getByTestId('notice-failure')).toBeVisible();
  });
});
