/**
 * Remote lock (KSK-10): a text-free out-of-service screen over the whole kiosk. No touch targets: it
 * swallows every touch so nothing underneath can start a session, and it stays until an `unlock`
 * command (it is persisted, so it also covers the kiosk after a reboot). Static, so nothing to reduce
 * under reduced motion.
 */
import type { CSSProperties, ReactElement, SyntheticEvent } from 'react';
import { COLORS } from './FallbackScreens.tsx';

const style: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 40,
  display: 'grid',
  placeItems: 'center',
  background: COLORS.ink,
  color: COLORS.paper,
  touchAction: 'none',
};

function swallow(e: SyntheticEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

export function RemoteLockScreen(): ReactElement {
  return (
    <div
      role="img"
      aria-label="Out of service"
      data-testid="kiosk-remote-lock"
      style={style}
      onPointerDown={swallow}
      onPointerUp={swallow}
      onContextMenu={swallow}
    >
      <svg viewBox="0 0 100 100" width={220} height={220} aria-hidden="true">
        <path
          d="M30 44 V32 a20 20 0 0 1 40 0 V44"
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          strokeLinecap="round"
        />
        <rect x={20} y={44} width={60} height={44} rx={10} fill="currentColor" />
        <circle cx={50} cy={62} r={6} fill={COLORS.ink} />
        <rect x={47} y={62} width={6} height={14} rx={3} fill={COLORS.ink} />
      </svg>
    </div>
  );
}
