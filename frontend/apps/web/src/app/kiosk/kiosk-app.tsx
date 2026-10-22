'use client';

/**
 * Client-only kiosk root (loaded with `ssr: false`): mounts the @shriii/kiosk-game runtime view,
 * which owns the Pixi stage and the session statechart (attract -> consent -> play -> report ->
 * wipe). Same wiring as frontend/apps/kiosk/src/App.tsx; dev-only code is behind NODE_ENV checks so it is
 * dropped from production bundles.
 */
import type { EventValidator, KioskRuntime, KioskRuntimeOptions } from '@shriii/kiosk-game';
import { KioskRuntimeView } from '@shriii/kiosk-game';
import { createArtKit } from '@shriii/kiosk-game/art';
import { AudioEngine } from '@shriii/kiosk-game/audio';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { readKioskConfig } from './kiosk-config';

const isDev = process.env.NODE_ENV !== 'production';

// Same art kit and audio engine as frontend/apps/kiosk; without them the runtime falls back to the flat
// placeholder scenes.
const ART_FACTORY: NonNullable<KioskRuntimeOptions['artFactory']> = (app, layout) =>
  createArtKit({ app, layout });
const AUDIO_FACTORY: NonNullable<KioskRuntimeOptions['audioFactory']> = (clock) =>
  new AudioEngine({ clock });

const DevPanel = isDev
  ? lazy(() => import('@shriii/kiosk-game').then((m) => ({ default: m.DevPanel })))
  : null;

async function loadDevValidator(): Promise<EventValidator | null> {
  if (!isDev) return null;
  const [{ ajvEventValidator }, { validateEventEnvelope }] = await Promise.all([
    import('@shriii/kiosk-game'),
    import('@shriii/contracts/validators/event-envelope'),
  ]);
  return ajvEventValidator(validateEventEnvelope);
}

export default function KioskApp({ entry }: { readonly entry: string }) {
  const config = useMemo(readKioskConfig, []);
  const [runtime, setRuntime] = useState<KioskRuntime | null>(null);
  const [validate, setValidate] = useState<EventValidator | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    loadDevValidator()
      .then((v) => {
        if (alive) setValidate(() => v);
      })
      .catch((err: unknown) => {
        console.warn('[kiosk] dev validator unavailable', err);
        if (alive) setValidate(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const options = useMemo(
    () => ({
      apiBase: config.apiBase,
      dev: config.dev,
      mode: config.mode,
      siteMode: config.siteMode,
      arm: config.arm,
      strictTargets: isDev,
      artFactory: ART_FACTORY,
      audioFactory: AUDIO_FACTORY,
      ...(config.pxPerMm ? { pxPerMm: config.pxPerMm } : {}),
      ...(validate ? { validate } : {}),
    }),
    [config, validate],
  );

  if (validate === undefined) return null;
  return (
    <div
      data-testid="kiosk-shell"
      data-entry={entry}
      style={{ position: 'fixed', inset: 0 }}
      onPointerDown={() => {
        if (!document.fullscreenElement) {
          void document.documentElement.requestFullscreen?.().catch(() => undefined);
        }
      }}
    >
      <KioskRuntimeView options={options} onRuntime={setRuntime}>
        {DevPanel && (
          <Suspense fallback={null}>
            <DevPanel runtime={runtime} pin={config.devPin} />
          </Suspense>
        )}
      </KioskRuntimeView>
    </div>
  );
}
