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

  test('orientation-flipping batch: zero-outlier success with canonical swap matrix', async ({ page }) => {
    // All eight correspondences are exact under H = [[1,0,0],[0,0,1],[0,1,0]]
    // ((x,y) -> (x/y, 1/y)); the y = -1 row is mirrored through the line at
    // infinity, so no source frame shares an affine-orientation pattern with
    // its target frame. The audit must still find the unique optimum.
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
    const ids = ['P1', 'P2', 'P3', 'P4', 'N1', 'N2', 'N3', 'N4'];

    await page.goto('/');
    await page.getByTestId('input-points').fill(batch);
    await page.getByTestId('input-limit').fill('0');
    await page.getByTestId('btn-run').click();
    await expect(page.getByTestId('notice-success')).toBeVisible();

    // Zero outliers: every identifier retained, none removed, one optimum.
    await expect(page.getByTestId('inlier-count')).toHaveText('8');
    await expect(page.getByTestId('outlier-count')).toHaveText('0');
    await expect(page.getByTestId('distinct-count')).toHaveText('1');
    await expect(page.getByTestId('frames-count')).toHaveText('36');

    // Canonical nine-integer matrix, row-major: 1,0,0 / 0,0,1 / 0,1,0.
    const expected = ['1', '0', '0', '0', '0', '1', '0', '1', '0'];
    for (let i = 0; i < 9; i++) {
      const cell = page.locator(`[data-testid=matrix] [data-pos="${Math.floor(i / 3)}${i % 3}"]`);
      expect((await cell.textContent())?.replace(/,/g, '')).toBe(expected[i]);
    }

    // Partition: all eight ids retained, removal list empty.
    const inChips = await page.getByTestId('inlier-list').locator('.chip').allTextContents();
    expect(inChips).toEqual(ids);
    await expect(page.getByTestId('outlier-list').locator('.chip')).toHaveCount(0);
    await expect(page.getByTestId('outlier-list')).toContainText('无');

    // Per-point table: every row is an exact coincidence.
    for (const id of ids) {
      await expect(page.getByTestId(`verdict-${id}`)).toHaveText('保留·精确重合');
    }

    // SVG overlay: eight coincident points, no outlier evidence at all.
    await expect(page.locator('svg .mk-inlier')).toHaveCount(8);
    await expect(page.locator('svg .mk-outlier')).toHaveCount(0);
    await expect(page.locator('svg .ln-residual')).toHaveCount(0);
    await expect(page.locator('svg .mk-proj')).toHaveCount(0);
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
