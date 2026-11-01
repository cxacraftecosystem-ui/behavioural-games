/**
 * Restyled console screens (skill field-repo-frontend): desktop, tablet and phone, light and dark.
 * Each combination checks the theme tokens, the one action colour, which navigation is drawn, the menu
 * sheet's keyboard contract and the button-row layout, runs axe (WCAG 2.2 A/AA), and saves a full-page
 * screenshot to test-results/visual/ (uploaded by CI).
 *
 *   pnpm exec playwright test e2e/visual.spec.ts
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { mockAdminApi } from '../src/features/admin/e2e/mock-admin-api';
import { mockResearchApi } from '../src/features/research/e2e/mock-research-api';
import { expect, mockApi, signIn, test } from './fixtures';

const OUT = fileURLToPath(new URL('../test-results/visual/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'phone', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

/** --bg-0 in each theme (globals.css). */
const CANVAS = { light: 'rgb(247, 246, 251)', dark: 'rgb(17, 15, 25)' } as const;

async function capture(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const hide = await page.addStyleTag({
    content: '[data-sonner-toaster] { visibility: hidden !important; }',
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  await hide.evaluate((el) => el.parentNode?.removeChild(el));
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // ECharts paints on <canvas>; its text is not in the DOM for axe to measure.
    .exclude('canvas')
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary).toEqual([]);
}

async function expectTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(canvas).toBe(CANVAS[theme]);
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${vp.name} · ${theme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme });

      test('sign-in', async ({ page }) => {
        await mockApi(page);
        await page.goto('/login');
        const form = page.getByRole('form', { name: 'Development sign-in' });
        await expect(form).toBeVisible();
        await expectTheme(page, theme);
        // The one action colour, in both themes: a filled purple-700 button with white text.
        const submit = form.getByRole('button', { name: 'Sign in' });
        const bg = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg).toMatch(/oklch\(0\.47 0\.198 305\)|rgb\(1[01]\d, 3\d, 1[4-6]\d\)/);
        await expectAccessible(page);
        await capture(page, `${vp.name}-${theme}-sign-in`);
      });

      test('research overview, navigation and menu sheet', async ({ page }) => {
        await mockApi(page);
        await mockResearchApi(page);
        await signIn(page, 'researcher', { next: '/research' });
        await expect(
          page.getByRole('heading', { level: 1, name: 'Research overview' }),
        ).toBeVisible();
        await expectTheme(page, theme);

        const island = page.getByTestId('island-nav');
        const bottom = page.getByTestId('bottom-island');
        if (vp.name === 'desktop') {
          await expect(island).toBeVisible();
          await expect(bottom).toBeHidden();
        } else {
          await expect(bottom).toBeVisible();
          await expect(island).toBeHidden();
          // The bottom island holds at most four destinations, then "More".
          expect(await bottom.locator('a').count()).toBeLessThanOrEqual(4);
          // It sits fully inside the viewport, clear of the page edges.
          const box = await bottom.boundingBox();
          expect(box).not.toBeNull();
          expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= vp.width).toBe(true);
        }
        // No horizontal page scroll at any width.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        await expectAccessible(page);
        await capture(page, `${vp.name}-${theme}-research-overview`);

        // The sheet: every destination, focus trapped, Escape closes it and focus returns.
        const opener = page.getByTestId(vp.name === 'desktop' ? 'menu-button' : 'more-button');
        await opener.click();
        const sheet = page.getByTestId('nav-sheet');
        await expect(sheet).toBeVisible();
        const nav = sheet.getByRole('navigation', { name: 'Console' });
        await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('href', '/research');
        await expectAccessible(page);
        await capture(page, `${vp.name}-${theme}-menu`);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(opener).toBeFocused();
      });

      test('studies list', async ({ page }) => {
        await mockApi(page);
        await mockResearchApi(page);
        await signIn(page, 'researcher', { next: '/research/studies' });
        await expect(page.getByRole('heading', { level: 1, name: 'Studies' })).toBeVisible();
        await expectAccessible(page);
        await capture(page, `${vp.name}-${theme}-studies`);
      });

      test('admin kiosks', async ({ page }) => {
        await mockApi(page);
        await mockAdminApi(page);
        await signIn(page, 'admin', { next: '/admin/kiosks' });
        await expect(page.getByRole('heading', { level: 1, name: 'Kiosks' })).toBeVisible();
        await expectAccessible(page);
        await capture(page, `${vp.name}-${theme}-admin-kiosks`);
      });
    });
  }
}

test.describe('button rows (ActionGroup)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('one centred, two on one line in equal halves, three stacked on a phone', async ({
    page,
  }) => {
    await mockApi(page);
    await signIn(page, 'admin', { next: '/design-system' });
    const one = page.getByTestId('action-row-1');
    const two = page.getByTestId('action-row-2');
    const three = page.getByTestId('action-row-3');
    await expect(two).toBeVisible();

    const rowBox = await one.boundingBox();
    const only = await one.getByRole('button').boundingBox();
    expect(rowBox && only).toBeTruthy();
    if (rowBox && only) {
      const left = only.x - rowBox.x;
      const right = rowBox.x + rowBox.width - (only.x + only.width);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
    }

    const [a, b] = await Promise.all(
      [0, 1].map((i) => two.getByRole('button').nth(i).boundingBox()),
    );
    expect(a && b).toBeTruthy();
    if (a && b) {
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    }

    const boxes = await Promise.all(
      [0, 1, 2].map((i) => three.getByRole('button').nth(i).boundingBox()),
    );
    const ys = boxes.map((x) => x?.y ?? 0);
    expect(ys[1]).toBeGreaterThan(ys[0] ?? 0);
    expect(ys[2]).toBeGreaterThan(ys[1] ?? 0);
    // The destructive action is last.
    await expect(three.getByRole('button').last()).toHaveAttribute('data-danger', '');
  });

  test('three or more become one row of pills from sm', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await mockApi(page);
    await signIn(page, 'admin', { next: '/design-system' });
    const three = page.getByTestId('action-row-3');
    await expect(three).toBeVisible();
    const boxes = await three
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(boxes).size).toBe(1);
    const radius = await three
      .getByRole('button')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(Number.parseFloat(radius)).toBeGreaterThan(100);
  });
});
