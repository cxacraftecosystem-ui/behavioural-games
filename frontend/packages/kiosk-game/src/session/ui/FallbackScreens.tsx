/**
 * Icon-only fallback screens for the session states the onboarding/report agents own (attract,
 * language, consent, bands, report, survey, opt-in, farewell). They are deliberately plain: real
 * screens plug in through `KioskRuntimeView`'s `screens` prop. Every target is >= 20 mm (sized in
 * mm via the layout's px-per-mm) and there is no text or numeral anywhere.
 *
 * Kiosk rules (skill §20): the art kit's tokens, so a fallback reads like the real screen. Confirm is
 * a teal CIRCLE with a tick, cancel a burnt-orange ROUNDED SQUARE with a cross (shape + icon + colour,
 * never colour alone); confirm sits on the right, cancel on the left; the icon on every face keeps
 * >= 4.5:1 against it (KSK-06); every control has an accessible name even though nothing is printed;
 * attention pulses stop under reduced motion and leave a static ring; the walkaway countdown keeps
 * running.
 */
import type { LanguageTag, SessionState } from '@shriii/contracts';
import {
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useState,
} from 'react';
import { KIOSK_PALETTE, MELA } from '../../art/palettes.ts';
import type {
  KioskSessionView,
  SessionController,
  SessionControllerEvent,
} from '../session-controller.ts';
import { Icon, type IconName } from './Icon.tsx';

/** Props every session screen receives. */
export interface KioskScreenProps {
  readonly view: KioskSessionView;
  readonly controller: SessionController;
  /** Send an event (also unlocks audio on the first touch). */
  readonly send: (event: SessionControllerEvent) => void;
  /** Stage px per mm (size targets in mm). */
  readonly pxPerMm: number;
}

export type ScreenMap = Partial<Record<SessionState, ComponentType<KioskScreenProps>>>;

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The art kit's contract tokens (art/palettes.ts KIOSK_PALETTE): one source for both renderers. */
export const COLORS = {
  confirm: hex(KIOSK_PALETTE.confirm),
  cancel: hex(KIOSK_PALETTE.cancel),
  accent: hex(MELA.lapis),
  paper: hex(MELA.cream),
  ink: hex(MELA.ink),
};
/**
 * Okabe-Ito, separable for every common colour-vision deficiency; order is the cue, never cycled. The
 * sixth slot is Tol's wine instead of Okabe-Ito vermilion: vermilion carries neither the cream nor the
 * dark icon at 4.5:1, and it reads as the cancel face.
 */
export const LANGUAGE_COLORS = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#882255'];

function luminance(color: string): number {
  const n = Number.parseInt(color.slice(1), 16);
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The language's own name for a screen reader (its autonym), or its position when unknown. */
function languageName(lang: string, index: number): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? `Language ${index + 1}`;
  } catch {
    return `Language ${index + 1}`;
  }
}

/** Contrast ratio between two `#rrggbb` colours (WCAG 2). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Cream or dark ink, whichever contrasts more with the face (KSK-06 asks for >= 4.5:1). */
export function iconInkFor(face: string): string {
  return contrastRatio(COLORS.paper, face) >= contrastRatio(COLORS.ink, face)
    ? COLORS.paper
    : COLORS.ink;
}

const centre: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-end',
  paddingBottom: '12vh',
  gap: '6vh',
};

function Row({ children }: { readonly children: ReactNode }): ReactElement {
  return <div style={{ display: 'flex', gap: '6vw', alignItems: 'center' }}>{children}</div>;
}

function BigButton(props: {
  readonly icon: IconName;
  readonly color: string;
  readonly onTap: () => void;
  readonly pxPerMm: number;
  readonly sizeMm?: number;
  readonly id: string;
  /** Accessible name (never printed: the kiosk needs no reading). */
  readonly label: string;
  /** Confirm-like = circle, cancel-like = rounded square (shape is a cue, not decoration). */
  readonly shape?: 'circle' | 'rounded';
  /** For a toggle: its on/off state. */
  readonly pressed?: boolean;
}): ReactElement {
  const px = Math.round((props.sizeMm ?? 34) * props.pxPerMm);
  return (
    <button
      type="button"
      data-target={props.id}
      aria-label={props.label}
      {...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed })}
      onPointerUp={props.onTap}
      style={{
        width: px,
        height: px,
        borderRadius: props.shape === 'rounded' ? '28%' : '50%',
        border: `${Math.round(px * 0.05)}px solid ${COLORS.paper}`,
        background: props.color,
        color: iconInkFor(props.color),
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        touchAction: 'none',
        padding: 0,
      }}
    >
      <Icon name={props.icon} size={px * 0.6} />
    </button>
  );
}

function Attract({ send }: KioskScreenProps): ReactElement {
  return (
    <button
      type="button"
      aria-label="Touch to start"
      style={{
        ...centre,
        justifyContent: 'center',
        cursor: 'pointer',
        border: 0,
        background: 'transparent',
        padding: 0,
      }}
      onPointerUp={() => send({ type: 'TOUCH_START' })}
      data-target="attract.touch"
    >
      <span className="shriii-pulse" style={{ color: COLORS.paper, display: 'grid' }}>
        <Icon name="hand" size={220} />
      </span>
    </button>
  );
}

function LanguageSelect({ view, send, pxPerMm }: KioskScreenProps): ReactElement {
  return (
    <div style={centre}>
      <Row>
        {view.languageFaceOrder.map((lang: LanguageTag, i) => (
          <BigButton
            key={lang}
            id={`language.${lang}`}
            label={languageName(lang, i)}
            icon="face_happy"
            color={LANGUAGE_COLORS[i % LANGUAGE_COLORS.length] ?? COLORS.accent}
            pxPerMm={pxPerMm}
            onTap={() => send({ type: 'LANGUAGE_SELECTED', language: lang, taps: 1 })}
          />
        ))}
      </Row>
    </div>
  );
}

function Consent({ send, pxPerMm }: KioskScreenProps): ReactElement {
  const [archive, setArchive] = useState(false);
  return (
    <div style={centre}>
      <BigButton
        id="consent.archive"
        label="Keep my answers for research"
        pressed={archive}
        shape="rounded"
        icon={archive ? 'box_checked' : 'box'}
        color={COLORS.accent}
        sizeMm={24}
        pxPerMm={pxPerMm}
        onTap={() => setArchive((a) => !a)}
      />
      <Row>
        <BigButton
          id="consent.decline"
          label="No"
          shape="rounded"
          icon="cross"
          color={COLORS.cancel}
          pxPerMm={pxPerMm}
          onTap={() => send({ type: 'CONSENT_DECLINED' })}
        />
        <BigButton
          id="consent.grant"
          label="Yes"
          icon="tick"
          color={COLORS.confirm}
          pxPerMm={pxPerMm}
          onTap={() => send({ type: 'CONSENT_GRANTED', tapConfirmed: true, archiveOptIn: archive })}
        />
      </Row>
    </div>
  );
}

function Bands({ send, pxPerMm }: KioskScreenProps): ReactElement {
  return (
    <div style={centre}>
      <Row>
        <BigButton
          id="bands.child"
          label="Under 18"
          shape="rounded"
          icon="child"
          color={COLORS.cancel}
          pxPerMm={pxPerMm}
          onTap={() => send({ type: 'UNDER_AGE' })}
        />
        <BigButton
          id="bands.adult"
          label="18 or older"
          icon="adult"
          color={COLORS.confirm}
          pxPerMm={pxPerMm}
          onTap={() =>
            send({
              type: 'BANDS_ANSWERED',
              bands: {
                age: 'prefer_not_to_say',
                literacy: 'prefer_not_to_say',
                edu: 'prefer_not_to_say',
                gender: 'prefer_not_to_say',
                device_use: 'prefer_not_to_say',
                played_before: 'prefer_not_to_say',
              },
            })
          }
        />
      </Row>
    </div>
  );
}

function Report({ send, pxPerMm }: KioskScreenProps): ReactElement {
  return (
    <div style={centre}>
      <div style={{ color: '#ffd166' }}>
        <Icon name="sun" size={200} />
      </div>
      <BigButton
        id="report.done"
        label="Done"
        icon="tick"
        color={COLORS.confirm}
        pxPerMm={pxPerMm}
        onTap={() => send({ type: 'REPORT_DONE' })}
      />
    </div>
  );
}

function Survey({ send, pxPerMm }: KioskScreenProps): ReactElement {
  const [enjoy, setEnjoy] = useState<'happy' | 'neutral' | 'sad' | null>(null);
  if (enjoy === null) {
    return (
      <div style={centre}>
        <Row>
          <BigButton
            id="survey.sad"
            label="Not fun"
            shape="rounded"
            icon="face_sad"
            color={COLORS.cancel}
            pxPerMm={pxPerMm}
            onTap={() => setEnjoy('sad')}
          />
          <BigButton
            id="survey.neutral"
            label="Okay"
            icon="face_neutral"
            color={COLORS.accent}
            pxPerMm={pxPerMm}
            onTap={() => setEnjoy('neutral')}
          />
          <BigButton
            id="survey.happy"
            label="Fun"
            icon="face_happy"
            color={COLORS.confirm}
            pxPerMm={pxPerMm}
            onTap={() => setEnjoy('happy')}
          />
        </Row>
      </div>
    );
  }
  return (
    <div style={centre}>
      <Row>
        <BigButton
          id="survey.again_no"
          label="Don't play again"
          shape="rounded"
          icon="cross"
          color={COLORS.cancel}
          pxPerMm={pxPerMm}
          onTap={() => send({ type: 'SURVEY_DONE', enjoy, playAgain: 'no' })}
        />
        <BigButton
          id="survey.again_yes"
          label="Play again"
          icon="tick"
          color={COLORS.confirm}
          pxPerMm={pxPerMm}
          onTap={() => send({ type: 'SURVEY_DONE', enjoy, playAgain: 'yes' })}
        />
      </Row>
    </div>
  );
}

function ContactOptIn({ send, pxPerMm }: KioskScreenProps): ReactElement {
  return (
    <div style={centre}>
      <Icon name="phone" size={160} style={{ color: COLORS.paper }} />
      <Row>
        <BigButton
          id="optin.no"
          label="Don't contact me"
          shape="rounded"
          icon="cross"
          color={COLORS.cancel}
          pxPerMm={pxPerMm}
          onTap={() => send({ type: 'OPTIN_DONE', contactOptIn: false })}
        />
        <BigButton
          id="optin.yes"
          label="Contact me"
          icon="tick"
          color={COLORS.confirm}
          pxPerMm={pxPerMm}
          onTap={() => send({ type: 'OPTIN_DONE', contactOptIn: true })}
        />
      </Row>
    </div>
  );
}

function Farewell(): ReactElement {
  return (
    <div style={{ ...centre, justifyContent: 'center', color: COLORS.paper }}>
      <Icon name="hand" size={220} />
    </div>
  );
}

/** Default screens per state (play/warm-up render on the Pixi stage; wipe is blank). */
export const FALLBACK_SCREENS: ScreenMap = {
  attract: Attract,
  languageSelect: LanguageSelect,
  consent: Consent,
  bands: Bands,
  report: Report,
  survey: Survey,
  contactOptIn: ContactOptIn,
  farewell: Farewell,
};

/** Persistent "hand" stop control (ONB-06): keep or delete. */
export function ExitControl({
  send,
  pxPerMm,
}: Pick<KioskScreenProps, 'send' | 'pxPerMm'>): ReactElement {
  const [open, setOpen] = useState(false);
  const size = Math.round(22 * pxPerMm);
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 16, zIndex: 20 }}>
      {open && (
        <>
          <BigButton
            id="exit.delete"
            label="Stop and delete my answers"
            shape="rounded"
            icon="bin"
            color={COLORS.cancel}
            sizeMm={22}
            pxPerMm={pxPerMm}
            onTap={() => send({ type: 'EXIT', erase: true })}
          />
          <BigButton
            id="exit.keep"
            label="Stop and keep my answers"
            icon="keep"
            color={COLORS.confirm}
            sizeMm={22}
            pxPerMm={pxPerMm}
            onTap={() => send({ type: 'EXIT', erase: false })}
          />
        </>
      )}
      <button
        type="button"
        data-target="exit.hand"
        aria-label="Stop"
        aria-expanded={open}
        onPointerUp={() => setOpen((o) => !o)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(29,29,27,0.55)',
          color: COLORS.paper,
          display: 'grid',
          placeItems: 'center',
          padding: 0,
        }}
      >
        <Icon name="hand" size={size * 0.6} />
      </button>
    </div>
  );
}

/** Walkaway overlay: re-prompt pulse, "still there?" and a shrinking countdown ring (no numbers). */
export function WalkawayOverlay({
  stage,
}: {
  readonly stage: KioskSessionView['walkawayStage'];
}): ReactElement | null {
  if (!stage) return null;
  const veil: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    background: stage === 'reprompt' ? 'transparent' : 'rgba(29,29,27,0.45)',
    pointerEvents: 'none',
    zIndex: 30,
    color: COLORS.paper,
  };
  if (stage === 'reprompt') {
    return (
      <div style={veil}>
        <div className="shriii-pulse shriii-pulse-fast" style={{ display: 'grid' }}>
          <Icon name="hand" size={160} />
        </div>
      </div>
    );
  }
  return (
    <div style={veil}>
      <div
        style={{
          position: 'relative',
          width: 260,
          height: 260,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {stage === 'countdown' && (
          <svg
            viewBox="0 0 100 100"
            width={260}
            height={260}
            style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
            aria-hidden="true"
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeDasharray="289"
              data-motion="essential"
              style={{ animation: 'shriii-ring 10s linear forwards' }}
            />
          </svg>
        )}
        <Icon name="question" size={150} />
      </div>
    </div>
  );
}

/**
 * Styles for the fallback shell. Pulses stay at or under 1 Hz (no flashing above 3 Hz). Under reduced
 * motion a pulse is replaced by a static cream ring, because a signal that exists only as motion is a
 * signal that reader never gets. The countdown ring is information (time left), not decoration, so it
 * is marked data-motion="essential" and keeps running.
 */
export const FALLBACK_CSS = `
@keyframes shriii-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes shriii-ring { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 289; } }
.shriii-pulse { border-radius: 50%; animation: shriii-pulse 2s ease-in-out infinite; }
.shriii-pulse-fast { animation-duration: 1s; }
[data-target]:focus-visible { outline: 6px solid ${COLORS.paper}; outline-offset: 6px; }
@media (prefers-reduced-motion: reduce) {
  .shriii-pulse { animation: none; box-shadow: 0 0 0 10px ${COLORS.paper}99; }
}
`;
