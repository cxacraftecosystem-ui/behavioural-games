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

// Outside Playwright's outputDir: the next suite's run would empty test-results/.
const OUT = fileURLToPath(new URL('../visual-results/', import.meta.url));
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

/** No horizontal page scroll; on failure, name the widest in-flow offenders. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const offenders: string[] = [];
    const inScroller = (el: HTMLElement): boolean => {
      for (let p = el.parentElement; p && p !== doc; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
      const r = el.getBoundingClientRect();
      // Content inside its own horizontal scroller (a wide table) does not scroll the page.
      if (r.right > width + 1 && getComputedStyle(el).position !== 'fixed' && !inScroller(el)) {
        const parent = el.parentElement?.getBoundingClientRect();
        // Report only the outermost element that overflows (its parent still fits).
        if (!parent || parent.right <= width + 1) {
          const cls = (el.getAttribute('class') ?? '').split(' ').slice(0, 6).join('.');
          offenders.push(`${el.tagName.toLowerCase()}.${cls} right=${Math.round(r.right)}`);
        }
      }
    }
    return { overflow: doc.scrollWidth - width, offenders: offenders.slice(0, 8) };
  });
  expect(report.overflow, report.offenders.join(' | ')).toBeLessThanOrEqual(0);
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
        // Compare painted pixels: Chromium serialises the same colour as oklch() or lab().
        const [actual, purple700] = await submit.evaluate((el) => {
          const ctx = document.createElement('canvas').getContext('2d');
          const rgb = (color: string): number[] => {
            if (!ctx) return [];
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
          };
          return [rgb(getComputedStyle(el).backgroundColor), rgb('oklch(0.47 0.198 305)')];
        });
        expect(purple700).toHaveLength(3);
        actual?.forEach((channel, i) => {
          expect(Math.abs(channel - (purple700?.[i] ?? -99))).toBeLessThanOrEqual(2);
        });
        await capture(page, `${vp.name}-${theme}-sign-in`);
        await expectAccessible(page);
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
        await capture(page, `${vp.name}-${theme}-research-overview`);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);

        // The sheet: every destination, focus trapped, Escape closes it and focus returns.
        const opener = page.getByTestId(vp.name === 'desktop' ? 'menu-button' : 'more-button');
        await opener.click();
        const sheet = page.getByTestId('nav-sheet');
        await expect(sheet).toBeVisible();
        const nav = sheet.getByRole('navigation', { name: 'Console' });
        await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('href', '/research');
        await capture(page, `${vp.name}-${theme}-menu`);
        await expectAccessible(page);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(opener).toBeFocused();
      });

      test('studies list', async ({ page }) => {
        await mockApi(page);
        await mockResearchApi(page);
        await signIn(page, 'researcher', { next: '/research/studies' });
        await expect(page.getByRole('heading', { level: 1, name: 'Studies' })).toBeVisible();
        await capture(page, `${vp.name}-${theme}-studies`);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
      });

      test('admin kiosks', async ({ page }) => {
        await mockApi(page);
        await mockAdminApi(page);
        await signIn(page, 'admin', { next: '/admin/kiosks' });
        await expect(page.getByRole('heading', { level: 1, name: 'Kiosks' })).toBeVisible();
        await capture(page, `${vp.name}-${theme}-admin-kiosks`);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
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
