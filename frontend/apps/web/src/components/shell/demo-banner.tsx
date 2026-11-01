import { FlaskConicalIcon } from 'lucide-react';
import { DEMO_BANNER_TITLE, DEMO_MODE } from '@/lib/demo';

/** Persistent demo-mode notice for every console page (renders nothing outside demo mode). */
export function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div
      role="note"
      aria-label="Demo mode"
      data-testid="demo-banner"
      className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
    >
      <FlaskConicalIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0">
        <strong className="font-semibold">Demo</strong> · {DEMO_BANNER_TITLE}. Read-only.
      </p>
    </div>
  );
}
