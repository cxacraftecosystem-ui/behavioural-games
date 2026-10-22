/**
 * ONB-05 + ENG-10: the merged practice/warm-up module, played in the fair at golden hour with the
 * guide, large pictogram targets (>= 20 mm), animated hand demonstrations and no text or numbers.
 *
 * Measurement first. The trial list, windows, hold threshold, ISIs, soft-cap trimming and the logged
 * events are exactly those of the engine's generic module for `content/games/shared/warmup.json`:
 * the seeded {@link DataDrivenTrialScheduler} schedule, `trial_start` -> `stimulus_onset` (frame
 * commit) -> `response` (+ `input.hold`) -> `trial_end`, so `warmupMetricsFromEvents` and the
 * calibration contract (`calibration.json`) read the same evidence. The art only changes what the
 * player sees: blocks `tap` (marigold), `hold` (brass diya with a filling ring), `choice` (say or
 * touch one of two fruit tiles: practice, no right answer) and `calibration` (marigold RT probes).
 *
 * Hand demonstrations play between blocks, never inside a trial window, so they do not touch the
 * response latencies of the RT blocks. Headless runs, and art kits without the onboarding extras,
 * delegate to the generic module (same schedule and events, scripted bot in headless mode).
 */
import type { GameTrialSpec } from '@shriii/contracts';
import { gsap } from 'gsap';
import { Container, Graphics } from 'pixi.js';
import { MELA } from '../../art/palettes.ts';
import { drawIcon } from '../../art/ui/icons.ts';
import type {
  ArtKit,
  EventLogger,
  GameModule,
  LineId,
  ModuleContext,
  ModuleResult,
  Point,
} from '../../core/contracts.ts';
import { abortReasonOf } from '../../core/contracts.ts';
import { GenericModule } from '../../engine/fallbacks/generic-module.ts';
import { DataDrivenTrialScheduler, type ScheduleResult } from '../../engine/scheduler.ts';
import { presentStimulus } from '../../engine/timing.ts';
import { diyaTarget, marigoldTarget } from '../pictograms.ts';
import { practiceConfigFromWarmup } from '../practiceConfig.ts';
import { ScreenKit } from '../ScreenKit.ts';
import {
  DEFAULT_ONBOARDING_CONFIG,
  type HandHintLike,
  type OnboardingArt,
  type OnboardingConfig,
  type SizedButton,
} from '../types.ts';

/** Physical target sizes (mm): all well above the 20 mm floor (KSK-06). */
const TAP_MM = 40;
const HOLD_MM = 50;
const CHOICE_MM = 46;
/** Hand-pointer size for the demonstrations (mm). */
const HAND_MM = 34;
/** Pause after a block's demonstration before its first trial (UX pacing, not a trial timing). */
const DEMO_SETTLE_MS = 250;

/** The two say-or-touch options (`option_a` / `option_b` in the warm-up vocabulary). */
const CHOICE_ICONS = { option_a: 'mango', option_b: 'flower' } as const;
type ChoiceCode = keyof typeof CHOICE_ICONS;

/** True when the art kit has the onboarding extras (picture tiles, hand hint): the Mela art kit. */
export function hasWarmupArt(art: ArtKit): art is ArtKit & OnboardingArt {
  const a = art as unknown as Partial<OnboardingArt>;
  return (
    typeof a.createPictureTile === 'function' &&
    typeof a.createHandHint === 'function' &&
    typeof a.createIconButton === 'function' &&
    typeof a.unit === 'number'
  );
}

function isHoldTrial(trial: GameTrialSpec): boolean {
  return trial.trial_type === 'hold' || trial.trial_type.startsWith('hold_');
}

export class WarmupModule implements GameModule {
  readonly id = 'warmup' as const;
  readonly kind = 'warmup' as const;
  readonly constructs = [] as const;
  readonly indicators = [] as const;
  private ctx: ModuleContext | null = null;
  private schedule: ScheduleResult | null = null;
  private kit: ScreenKit | null = null;
  private fallback: GenericModule | null = null;
  private targets: SizedButton[] = [];
  /** Option code of each choice tile, parallel to {@link targets}. */
  private choiceCodes: ChoiceCode[] = [];
  private hint: HandHintLike | null = null;

  async init(ctx: ModuleContext): Promise<void> {
    if (ctx.dev.headless || !hasWarmupArt(ctx.art)) {
      this.fallback = new GenericModule(this.id, this.kind);
      return this.fallback.init(ctx);
    }
    this.ctx = ctx;
    this.schedule = new DataDrivenTrialScheduler().build(
      ctx.config,
      ctx.level,
      ctx.rng.stream('schedule'),
      ctx.session.formId,
    );
    const config: OnboardingConfig = {
      ...DEFAULT_ONBOARDING_CONFIG,
      languages: [ctx.language],
      packVersion: '',
      manifestHash: '',
      consentScriptId: '',
      consentVersionHash: '',
      policyVersion: '',
      practice: practiceConfigFromWarmup(ctx.config, ctx.level),
    };
    const kit = new ScreenKit(
      {
        app: ctx.app,
        stage: ctx.stage,
        layout: ctx.layout,
        art: ctx.art,
        audio: ctx.audio,
        voice: ctx.voice,
        input: ctx.input,
        logger: ctx.logger,
        clock: ctx.clock,
        rng: ctx.rng,
        signal: ctx.signal,
      },
      config,
    );
    this.kit = kit;
    kit.setScene('attract', 'golden_hour');
    const guide = kit.ensureGuide();
    guide.setExpression('happy');
  }

  async run(): Promise<ModuleResult> {
    if (this.fallback) return this.fallback.run();
    const ctx = this.ctx;
    const schedule = this.schedule;
    const kit = this.kit;
    if (!ctx || !schedule || !kit) throw new Error('WarmupModule.run before init');
    const startMs = ctx.clock.now();
    const intro = ctx.config.audio_keys.find((k) => k.endsWith('.intro'));
    if (intro) await kit.say(intro as LineId);
    let completed = 0;
    let scorable = 0;
    const softCap = ctx.config.budget.soft_cap_ms;
    const blockMin = new Map(ctx.config.blocks.map((b) => [b.block_id, b.min_trials] as const));
    const doneInBlock = new Map<string, number>();
    const rng = ctx.rng.stream('warmup.layout');
    let currentBlock: string | null = null;

    for (const trial of schedule.trials) {
      if (ctx.signal.aborted) break;
      const inBlock = doneInBlock.get(trial.block_id) ?? 0;
      // Soft cap: graceful wrap-up keeps each block's minimum (ENG-05), as in the generic module.
      if (ctx.clock.now() - startMs > softCap && inBlock >= (blockMin.get(trial.block_id) ?? 0))
        continue;
      if (trial.block_id !== currentBlock) {
        currentBlock = trial.block_id;
        await this.demonstrate(trial);
        if (ctx.signal.aborted) break;
      }
      const outcome = await this.runTrial(ctx, kit, trial, rng);
      if (outcome === 'aborted') break;
      completed += 1;
      if (trial.scorable) scorable += 1;
      doneInBlock.set(trial.block_id, inBlock + 1);
    }

    if (!ctx.signal.aborted) {
      this.hint?.stop();
      kit.guide?.setExpression('happy');
      void kit.guide?.play('celebrate');
      const outro = ctx.config.audio_keys.find((k) => k.endsWith('.done'));
      const spoken = outro ? kit.say(outro as LineId) : Promise.resolve();
      await Promise.race([
        spoken,
        ctx.clock.delay(ctx.config.budget.outro_ms, ctx.signal).catch(() => undefined),
      ]);
    }
    const reason = abortReasonOf(ctx.signal);
    return {
      moduleId: this.id,
      endedReason: reason ? (reason.kind === 'crash' ? 'error' : reason.kind) : 'completed',
      durationMs: ctx.clock.now() - startMs,
      trialsCompleted: completed,
      scorableTrials: scorable,
      contextShiftIndex: schedule.contextShiftIndex,
    };
  }

  /* ------------------------------------------------------------------ block demonstrations */

  /** Spoken cue plus an animated hand on a non-interactive demo target (outside any trial window). */
  private async demonstrate(trial: GameTrialSpec): Promise<void> {
    const ctx = this.ctx;
    const kit = this.kit;
    if (!ctx || !kit) return;
    const block = trial.block_id;
    const line = ctx.config.audio_keys.find((k) => k === `warmup.${block}`);
    if (line) void kit.say(line as LineId);
    const area = kit.contentRect();
    const centre: Point = { x: area.x + area.width / 2, y: area.y + area.height * 0.55 };
    let at: Point = centre;
    let demo: Container | null = null;
    let kind: 'tap' | 'hold' | 'say_or_touch' | null = null;
    let durationMs = 0;
    const art = kit.services.art;
    if (block === 'tap') {
      demo = art.createPictureTile(
        'warmup.demo.tap',
        marigoldTarget(kit.mm(TAP_MM)),
        TAP_MM,
        MELA.marigold,
      ).view;
      kind = 'tap';
      durationMs = 1600;
    } else if (block === 'hold') {
      demo = art.createPictureTile(
        'warmup.demo.hold',
        diyaTarget(kit.mm(HOLD_MM)),
        HOLD_MM,
        MELA.terracotta,
      ).view;
      kind = 'hold';
      durationMs = 900 + (ctx.levelConfig.timing.hold_required_ms ?? 1200);
    } else if (block === 'choice') {
      demo = this.choiceDemo(kit);
      kind = 'say_or_touch';
      durationMs = 1700;
      at = { x: centre.x - (kit.mm(CHOICE_MM) + kit.mm(14)) / 2, y: centre.y };
    }
    if (!demo || !kind) return;
    demo.position.set(centre.x, centre.y);
    // Fully visible at once: the demo must read clearly even when frames are slow.
    demo.alpha = 0.92;
    demo.eventMode = 'none';
    kit.ui.addChild(demo);
    void kit.guide?.pointAt?.(at);
    this.hint ??= art.createHandHint(HAND_MM);
    kit.ui.addChild(this.hint.view);
    this.hint.show(kind, at, ctx.levelConfig.timing.hold_required_ms ?? 1200);
    try {
      // Flow waits on the session clock only (tweens may stretch on slow frames).
      await ctx.clock.delay(durationMs, ctx.signal);
      this.hint.stop();
      gsap.to(demo, { alpha: 0, duration: 0.2 });
      await ctx.clock.delay(DEMO_SETTLE_MS, ctx.signal);
    } catch {
      // aborted: teardown happens in destroy()
    } finally {
      this.hint?.stop();
      kit.guide?.clearLook?.();
      gsap.killTweensOf(demo);
      if (!demo.destroyed) demo.destroy({ children: true });
    }
  }

  private choiceDemo(kit: ScreenKit): Container {
    const c = new Container();
    const gap = kit.mm(CHOICE_MM) + kit.mm(14);
    (['option_a', 'option_b'] as const).forEach((code, i) => {
      const tile = new Graphics();
      const s = kit.mm(CHOICE_MM);
      tile.roundRect(-s / 2, -s / 2, s, s, s * 0.16).fill({ color: 0xfff6e4, alpha: 0.95 });
      tile.roundRect(-s / 2, -s / 2, s, s, s * 0.16).stroke({
        width: kit.mm(1.2),
        color: MELA.marigold,
      });
      const icon = drawIcon(CHOICE_ICONS[code], s * 0.7, MELA.ink);
      const holder = new Container();
      holder.addChild(tile, icon);
      holder.x = (i - 0.5) * gap;
      c.addChild(holder);
    });
    return c;
  }

  /* ------------------------------------------------------------------ trials */

  private async runTrial(
    ctx: ModuleContext,
    kit: ScreenKit,
    trial: GameTrialSpec,
    rng: ModuleContext['rng'],
  ): Promise<'done' | 'aborted'> {
    const block = ctx.config.blocks.find((b) => b.block_id === trial.block_id);
    const task = {
      episode_id: trial.episode_id,
      module_id: trial.module_id,
      block_id: trial.block_id,
      trial_id: trial.trial_id,
      trial_index: trial.trial_index,
      probe_group_id: trial.probe_group_id,
      form_id: trial.form_id,
      anchor_trial: trial.anchor_trial,
    };
    const condition = {
      phase: trial.phase,
      condition_id: trial.condition_id,
      shift_active: block?.conditions.shift_active ?? false,
      timer: block?.conditions.timer ?? false,
      noise: block?.conditions.noise ?? false,
      calibration_level: trial.calibration_level,
      variant_seed: String((trial.params as { variant?: number }).variant ?? 0),
    };
    const log = ctx.logger.child({ task, condition, scorable: trial.scorable });
    const trialStart = ctx.clock.now();
    log.log('trial_start', {
      trial_type: trial.trial_type,
      stimulus_id: trial.stimulus_id,
      response_window_ms: trial.response_window_ms,
      private_report: trial.private_report,
      expected_response: trial.expected_response,
    });

    const isHold = isHoldTrial(trial);
    const isChoice = trial.block_id === 'choice' || trial.condition_id === 'choice';
    const buttons = this.buildTargets(kit, trial, rng, isHold, isChoice);
    const stimulusId = trial.stimulus_id ?? `${trial.module_id}.${trial.trial_type}`;
    const presented = await presentStimulus(ctx.clock, () => {
      for (const b of buttons) b.view.visible = true;
    });
    log.log(
      'stimulus_onset',
      {
        stimulus_id: stimulusId,
        stimulus_version: 'warmup.2',
        requested_onset_ms: presented.requestedOnsetMs,
        presented_onset_ms: presented.presentedOnsetMs,
        audio_onset_ms: null,
        onset_source: 'raf_commit',
        duration_ms: trial.timing.stimulus_duration_ms,
      },
      { timingFlag: presented.timingFlag },
    );

    const window = trial.response_window_ms;
    const requiredHold = ctx.levelConfig.timing.hold_required_ms ?? 1000;
    let responded = false;
    let latency: number | null = null;
    let xy: readonly [number, number] | null = null;
    let holdMs: number | null = null;
    let value: string | null = null;
    const first = buttons[0];
    if (isHold && first) {
      const stopRing = this.holdRing(ctx, kit, first, requiredHold);
      const input = ctx.input as { setLogger?: (l: EventLogger | null) => void };
      // `input.hold` must carry this trial's task scope (calibration reads it per block).
      input.setLogger?.(log);
      try {
        const r = await ctx.input.waitForHold(first.targetId, {
          requiredMs: requiredHold,
          windowMs: window,
          signal: ctx.signal,
        });
        if (r.kind === 'aborted') return this.endAborted(log, trialStart);
        if (r.kind === 'hold') {
          responded = true;
          latency = Math.round((r.startMs - presented.presentedOnsetMs) * 1000) / 1000;
          holdMs = r.holdMs;
          value = 'hold';
        }
      } finally {
        input.setLogger?.(ctx.logger);
        stopRing();
      }
    } else {
      const r = await ctx.input.waitForTap(
        buttons.map((b) => b.targetId),
        { anchorMs: presented.presentedOnsetMs, windowMs: window, signal: ctx.signal },
      );
      if (r.kind === 'aborted') return this.endAborted(log, trialStart);
      if (r.kind === 'tap') {
        responded = true;
        latency = r.latencyMs;
        xy = r.tap.xyNorm;
        const hit = buttons.findIndex((b) => b.targetId === r.tap.targetId);
        value = isChoice ? (this.choiceCodes[hit] ?? null) : 'tap';
        buttons[hit]?.press?.();
      }
    }

    const expected = trial.expected_response;
    const holdOk = isHold && holdMs !== null ? holdMs >= requiredHold : true;
    let correctness: boolean | null;
    let outcome: 'correct' | 'incorrect' | 'omission' | 'commission' | 'timeout' | 'not_applicable';
    if (expected === 'no_tap') {
      correctness = !responded;
      outcome = responded ? 'commission' : 'correct';
    } else if (expected === 'tap' || expected === 'hold') {
      correctness = responded && holdOk;
      outcome = responded ? (correctness ? 'correct' : 'incorrect') : 'omission';
    } else {
      correctness = null;
      outcome = responded ? 'not_applicable' : 'timeout';
    }
    log.log(
      'response',
      {
        stimulus_id: stimulusId,
        response_value: responded ? value : null,
        correctness: responded ? correctness : null,
        input_mode: responded ? 'touch' : 'timeout',
        latency_ms: responded ? latency : null,
        latency_anchor: 'visual_onset',
        barge_in: responded && latency !== null && latency < 0,
        hold_ms: holdMs,
        tap_count: responded ? 1 : 0,
        revisions: [],
        touch_xy_norm: xy ? [xy[0], xy[1]] : null,
      },
      { timingFlag: presented.timingFlag },
    );
    log.log('trial_end', {
      outcome,
      correctness,
      response_count: responded ? 1 : 0,
      duration_ms: Math.round((ctx.clock.now() - trialStart) * 1000) / 1000,
    });
    this.feedback(ctx, kit, buttons, responded && correctness !== false, isHold);

    const isi = Math.max(0, (trial.timing.isi_ms ?? 300) + (trial.timing.jitter_ms ?? 0));
    (ctx.input as { markIsi?: () => void }).markIsi?.();
    try {
      await ctx.clock.delay(isi, ctx.signal);
    } catch {
      this.clearTargets();
      return 'aborted';
    }
    this.clearTargets();
    return 'done';
  }

  /** Create (hidden) the trial's targets: marigold, diya or the two fruit tiles. */
  private buildTargets(
    kit: ScreenKit,
    trial: GameTrialSpec,
    rng: ModuleContext['rng'],
    isHold: boolean,
    isChoice: boolean,
  ): SizedButton[] {
    const area = kit.contentRect();
    const out: SizedButton[] = [];
    const audioKey = `warmup.${trial.block_id}` as LineId;
    if (isHold) {
      const x = area.x + area.width / 2;
      const y = area.y + area.height * 0.55;
      out.push(
        kit.tile(
          `warmup.hold.${trial.trial_index}`,
          diyaTarget(kit.mm(HOLD_MM)),
          HOLD_MM,
          x,
          y,
          audioKey,
          MELA.terracotta,
        ),
      );
      kit.registerTarget(out[0] as SizedButton, audioKey, 'hold');
    } else if (isChoice) {
      const gap = kit.mm(CHOICE_MM) + kit.mm(14);
      const order = rng.shuffle(['option_a', 'option_b'] as const);
      this.choiceCodes = [...order];
      order.forEach((code, i) => {
        const pic = new Container();
        pic.addChild(drawIcon(CHOICE_ICONS[code], kit.mm(CHOICE_MM) * 0.7, MELA.ink));
        out.push(
          kit.tile(
            `warmup.choice.${trial.trial_index}.${code}`,
            pic,
            CHOICE_MM,
            area.x + area.width / 2 + (i - 0.5) * gap,
            area.y + area.height * 0.55,
            audioKey,
          ),
        );
      });
    } else {
      // Seeded positions inside the lower part of the content area (targets in the lower 2/3).
      const margin = kit.mm(TAP_MM) * 0.7;
      // Portrait: keep clear of the guide standing in the bottom-left corner.
      const left = area.x + margin + (kit.portrait ? area.width * 0.25 : 0);
      const x = left + rng.next() * Math.max(1, area.x + area.width - margin - left);
      const y = area.y + area.height * (0.35 + rng.next() * 0.4);
      out.push(
        kit.tile(
          `warmup.${trial.block_id}.${trial.trial_index}`,
          marigoldTarget(kit.mm(TAP_MM)),
          TAP_MM,
          x,
          y,
          audioKey,
          MELA.marigold,
        ),
      );
    }
    for (const b of out) b.view.visible = false;
    this.targets = out;
    return out;
  }

  /** A ring around the diya that fills while the player holds (starts on their press). */
  private holdRing(
    ctx: ModuleContext,
    kit: ScreenKit,
    target: SizedButton,
    requiredMs: number,
  ): () => void {
    const ring = new Graphics();
    ring.position.copyFrom(target.view.position);
    ring.eventMode = 'none';
    kit.ui.addChild(ring);
    const r = target.sizePx * 0.62;
    const state = { p: 0 };
    const draw = (): void => {
      ring.clear();
      ring.circle(0, 0, r).stroke({ width: kit.mm(2.2), color: 0xfff1c9, alpha: 0.35 });
      if (state.p > 0) {
        ring
          .arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + state.p * Math.PI * 2)
          .stroke({ width: kit.mm(2.6), color: MELA.saffron, cap: 'round' });
      }
    };
    draw();
    let tween: gsap.core.Tween | null = null;
    const unsub = ctx.input.onRawTap((tap) => {
      if (tap.targetId !== target.targetId) return;
      tween?.kill();
      state.p = 0;
      tween = gsap.to(state, {
        p: 1,
        duration: requiredMs / 1000,
        ease: 'none',
        onUpdate: draw,
      });
    });
    return () => {
      unsub();
      tween?.kill();
      if (!ring.destroyed) ring.destroy();
    };
  }

  /** Gentle, never punitive feedback: petals and a chime, or a soft tap sound. */
  private feedback(
    ctx: ModuleContext,
    kit: ScreenKit,
    buttons: readonly SizedButton[],
    good: boolean,
    isHold: boolean,
  ): void {
    const b = buttons[0];
    if (!good || !b) {
      ctx.audio.playSfx('tap_soft');
      return;
    }
    ctx.audio.playSfx(isHold ? 'chime' : 'correct');
    const { x, y } = b.view.position;
    if (isHold) void kit.services.art.glow?.(x, y, b.sizePx);
    const fx = ctx.art.createParticles({ kind: 'petals', origin: { x, y }, count: 14 });
    kit.ui.addChild(fx.view);
    void ctx.clock
      .delay(2500)
      .catch(() => undefined)
      .then(() => fx.destroy());
  }

  private clearTargets(): void {
    for (const b of this.targets.splice(0)) this.kit?.removeButton(b);
  }

  private endAborted(log: EventLogger, trialStart: number): 'aborted' {
    this.clearTargets();
    log.log(
      'trial_end',
      {
        outcome: 'aborted',
        correctness: null,
        response_count: 0,
        duration_ms: Math.round((this.ctx?.clock.now() ?? trialStart) - trialStart),
      },
      { interrupted: true },
    );
    return 'aborted';
  }

  destroy(): void {
    this.fallback?.destroy();
    this.targets = [];
    this.hint?.destroy();
    this.hint = null;
    this.kit?.destroy();
    this.kit = null;
    this.ctx = null;
  }
}

/** Factory for the module registry. */
export function createWarmup(): WarmupModule {
  return new WarmupModule();
}
