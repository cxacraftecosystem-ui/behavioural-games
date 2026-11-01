import { cn } from '@/lib/utils';

/**
 * The one progress bar (skill §11.12). Track = `--progress-track` (a tint, never the card's own white),
 * fill = `--progress-fill` (purple-700 light, purple-400 dark: >= 3:1 against the track AND the card in
 * both themes). At least 4px tall with round ends. Never hand-roll `bg-muted` + `bg-primary`: that pair
 * is 1.1:1 on the card and the bar disappears.
 */
export function ProgressBar({
  value,
  max = 1,
  label,
  className,
  decorative = false,
}: {
  /** Progress in the same unit as `max` (default: a share 0..1). */
  readonly value: number;
  readonly max?: number;
  /** Accessible name (omit only when `decorative`, i.e. a neighbouring number already says it). */
  readonly label?: string;
  readonly className?: string;
  readonly decorative?: boolean;
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      className={cn('progress-track', className)}
      {...(decorative
        ? { 'aria-hidden': true }
        : {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': max,
            'aria-valuenow': Math.min(max, Math.max(0, value)),
          })}
    >
      <div className="progress-fill" style={{ width: `${share * 100}%` }} />
    </div>
  );
}
