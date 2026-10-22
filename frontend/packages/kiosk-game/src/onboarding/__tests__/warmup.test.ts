/**
 * ONB-05/ENG-10: the fair-world warm-up keeps the measurement contract of the generic warm-up: the
 * same seeded trials from `warmup.json`, valid events, `input.hold` scoped to the hold block, and
 * metrics `warmupMetricsFromEvents` turns into a calibration decision. Art never gates measurement.
 */
import './canvasStub.ts';
import { checkSessionSequence, type EventEnvelope } from '@shriii/contracts';
import { validateEventEnvelope } from '@shriii/contracts/validators/event-envelope';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { staticLayout } from '../../art/layout.ts';
import type { EventLogger, ModuleContext } from '../../core/contracts.ts';
import { decideCalibration, warmupMetricsFromEvents } from '../../engine/calibration.ts';
import { SessionClock } from '../../engine/clock.ts';
import { loadGameContent } from '../../engine/content.ts';
import { createSessionRng } from '../../engine/rng.ts';
import { DataDrivenTrialScheduler } from '../../engine/scheduler.ts';
import { TEST_CONTEXT, TEST_VERSIONS } from '../../logging/__tests__/helpers.ts';
import { ajvEventValidator, createSessionLogger } from '../../logging/event-logger.ts';
import { MemoryOutbox } from '../../logging/outbox/memory-outbox.ts';
import { ScriptedInput } from '../harness/inputs.ts';
import { createWarmup } from '../warmup/WarmupModule.ts';
import { FakeArt, InstantVoice, silentAudio } from './fakes.ts';

/** Scripted input that logs `input.hold` through the module-scoped logger, like the DOM input layer. */
class LoggingInput extends ScriptedInput {
  logger: EventLogger | null = null;
  setLogger(l: EventLogger | null): void {
    this.logger = l;
  }
  protected override deliverHold(targetId: string, startMs: number, holdMs: number): void {
    const required = [...this.holdWaiters].find((w) => w.id === targetId)?.requiredMs ?? 0;
    this.logger?.log('input.hold', {
      target_id: targetId,
      hold_ms: holdMs,
      required_hold_ms: required,
      completed: holdMs >= required,
    });
    super.deliverHold(targetId, startMs, holdMs);
  }
}

describe('fair-world warm-up (ONB-05, ENG-10)', () => {
  it('runs the warmup.json schedule with valid events and calibration-ready metrics', async () => {
    const content = loadGameContent();
    const config = content.get('warmup');
    const clock = new SessionClock({
      anchorPerfMs: Date.now(),
      platform: {
        perfNow: () => Date.now(),
        wallNow: () => Date.now(),
        requestFrame: (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number,
      },
    });
    const outbox = new MemoryOutbox({ kioskId: 'kiosk-test' });
    const logger = createSessionLogger({
      sessionId: '01a15df9-9480-78bd-98a1-a021f6e0e2f9',
      outbox,
      clock,
      context: () => TEST_CONTEXT,
      versions: TEST_VERSIONS,
      consentGranted: () => true,
      validate: ajvEventValidator(validateEventEnvelope),
    });
    logger.log('session_start', {
      seed: '0123456789abcdef',
      rng_algorithm: 'pcg32',
      refresh_hz: 60,
      arm_source: 'forced',
      stratum: null,
      slot_form: null,
    });
    const layout = staticLayout(1920, 1080);
    const art = new FakeArt();
    const input = new LoggingInput(clock, layout.metrics, (ids) => ids[0] ?? null);
    const moduleLogger = logger.child({
      task: {
        episode_id: null,
        module_id: 'warmup',
        block_id: null,
        trial_id: null,
        trial_index: null,
        probe_group_id: null,
        form_id: 'form_1',
        anchor_trial: false,
      },
      condition: null,
      scorable: false,
    });
    input.setLogger(moduleLogger);
    const rng = createSessionRng('00000000000000ff');
    const ctx = {
      app: { stage: new Container() },
      stage: new Container(),
      layout,
      rng: rng.stream('warmup'),
      logger: moduleLogger,
      audio: silentAudio,
      voice: new InstantVoice(),
      input,
      art: { ...art, palette: {}, createIcon: () => new Container() } as never,
      clock,
      level: 'L2',
      language: 'hi-IN',
      config,
      levelConfig: config.levels.L2,
      session: {
        sessionId: logger.sessionId,
        pathway: 'B',
        mode: 'pilot',
        siteMode: 'supervised',
        formId: 'form_1',
        slotForm: null,
        headset: false,
        slowPace: false,
      },
      signal: new AbortController().signal,
      dev: { overlay: false, voicePlaceholder: false, headless: false },
    } as unknown as ModuleContext;
    // FakeArt methods live on the prototype: bind them onto the context art.
    for (const k of Object.getOwnPropertyNames(FakeArt.prototype)) {
      const fn = (art as unknown as Record<string, unknown>)[k];
      if (typeof fn === 'function' && k !== 'constructor')
        (ctx.art as unknown as Record<string, unknown>)[k] = fn.bind(art);
    }

    const module = createWarmup();
    await module.init(ctx);
    const result = await module.run();
    module.destroy();
    expect(result.endedReason).toBe('completed');

    const expected = new DataDrivenTrialScheduler().build(
      config,
      'L2',
      createSessionRng('00000000000000ff').stream('warmup').stream('schedule'),
      'form_1',
    );
    expect(result.trialsCompleted).toBe(expected.trials.length);

    await logger.flush();
    const events = (await outbox.sessionEvents(logger.sessionId)) as EventEnvelope[];
    expect(checkSessionSequence(events)).toEqual([]);
    expect(events.filter((e) => e.event_type === 'invalid')).toEqual([]);
    const trialIds = events
      .filter((e) => e.event_type === 'trial_start')
      .map((e) => e.task?.trial_id);
    expect(trialIds).toEqual(expected.trials.map((t) => t.trial_id));
    expect(
      events.filter((e) => e.task?.module_id === 'warmup').every((e) => !e.timing.scorable),
    ).toBe(true);
    const holds = events.filter((e) => e.event_type === 'input.hold');
    expect(holds.length).toBeGreaterThan(0);
    expect(holds.every((e) => e.task?.block_id === 'hold')).toBe(true);
    const choices = events.filter(
      (e) => e.event_type === 'response' && e.task?.block_id === 'choice',
    );
    expect(
      choices.every((e) =>
        ['option_a', 'option_b'].includes(
          String((e.payload as { response_value?: unknown }).response_value),
        ),
      ),
    ).toBe(true);

    const metrics = warmupMetricsFromEvents(events, config);
    expect(metrics.summary.practice_struggle).toBe(false);
    expect(metrics.summary.skills.every((s) => s.completed)).toBe(true);
    expect(metrics.warmupRtMs).not.toBeNull();
    expect(metrics.warmupAccuracy).toBe(1);
    const decision = decideCalibration({
      policy: 'fixed_L2_with_L1_fallback',
      practiceStruggle: metrics.summary.practice_struggle,
      slowPace: false,
      warmupRtMs: metrics.warmupRtMs,
      warmupAccuracy: metrics.warmupAccuracy,
    });
    expect(decision.level).toBe('L2');
  }, 60_000);
});
