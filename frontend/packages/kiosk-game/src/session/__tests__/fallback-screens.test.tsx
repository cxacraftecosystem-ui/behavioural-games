import { describe, expect, it } from 'vitest';
import {
  COLORS,
  contrastRatio,
  FALLBACK_CSS,
  iconInkFor,
  LANGUAGE_COLORS,
} from '../ui/FallbackScreens.tsx';

describe('fallback screens (skill §20 kiosk rules)', () => {
  it('keeps every icon at or above 3:1 against its face (WCAG 1.4.11)', () => {
    for (const face of [COLORS.confirm, COLORS.cancel, COLORS.accent, ...LANGUAGE_COLORS]) {
      expect(contrastRatio(iconInkFor(face), face), face).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses the art kit confirm/cancel faces with the cream icon above 4.5:1', () => {
    expect(COLORS.confirm).toBe('#12707a');
    expect(COLORS.cancel).toBe('#c2410c');
    expect(contrastRatio(COLORS.paper, COLORS.confirm)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(COLORS.paper, COLORS.cancel)).toBeGreaterThanOrEqual(4.5);
  });

  it('stops attention pulses under reduced motion and leaves a static ring', () => {
    expect(FALLBACK_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.shriii-pulse \{ animation: none; box-shadow/,
    );
  });

  it('pulses no faster than 1 Hz (well under the 3 Hz flash limit)', () => {
    const periods = [
      ...FALLBACK_CSS.matchAll(/animation(?:-duration)?: (?:shriii-pulse )?(\d+(?:\.\d+)?)s/g),
    ].map((m) => Number(m[1]));
    expect(periods.length).toBeGreaterThan(0);
    for (const p of periods) expect(p).toBeGreaterThanOrEqual(1);
  });
});
