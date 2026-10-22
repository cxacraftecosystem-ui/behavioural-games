import { describe, expect, it } from 'vitest';
import type { Clock, TimingProfile } from '../../core/contracts.ts';
import {
  CI_HEADLESS_TEST_TIMING_PROFILE,
  DEV_TIMING_PROFILE,
  isTestTimingProfile,
} from '../clock.ts';
import { presentStimulus } from '../timing.ts';

/** Clock whose frames arrive every `frameMs` (a slow software renderer). */
function slowClock(profile: TimingProfile, frameMs: number): Clock {
  let t = 0;
  return {
    profile,
    now: () => t,
    nextFrame: async () => {
      t += frameMs;
      return t;
    },
  } as unknown as Clock;
}

describe('ci-headless-test timing profile', () => {
  it('is certified, test-only and distinct from the uncertified dev profile', () => {
    expect(CI_HEADLESS_TEST_TIMING_PROFILE.certified).toBe(true);
    expect(isTestTimingProfile(CI_HEADLESS_TEST_TIMING_PROFILE.version)).toBe(true);
    expect(isTestTimingProfile(DEV_TIMING_PROFILE.version)).toBe(false);
    expect(DEV_TIMING_PROFILE.certified).toBe(false);
  });

  it('flags late onsets against the profile tolerance (kiosk default: half a frame)', async () => {
    const dev = await presentStimulus(slowClock(DEV_TIMING_PROFILE, 900), () => undefined);
    expect(dev.timingFlag).toBe('late_onset');
    const ci = await presentStimulus(
      slowClock(CI_HEADLESS_TEST_TIMING_PROFILE, 900),
      () => undefined,
    );
    expect(ci.timingFlag).toBe('ok');
    const tooSlow = await presentStimulus(
      slowClock(CI_HEADLESS_TEST_TIMING_PROFILE, 4000),
      () => undefined,
    );
    expect(tooSlow.timingFlag).toBe('late_onset');
    const fast = await presentStimulus(slowClock(DEV_TIMING_PROFILE, 16), () => undefined);
    expect(fast.timingFlag).toBe('uncertified_timing_profile');
  });
});
