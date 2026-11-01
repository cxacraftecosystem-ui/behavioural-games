'use client';

import { ExternalLinkIcon, MonitorIcon, MoonIcon, SunIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { NavSection } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { NavIcon } from './nav-icon';

const THEMES = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
] as const;

/** Light / Dark / System. A segmented control, not an action row (so not an ActionGroup). */
function ThemeSegmented() {
  const { theme, setTheme } = useTheme();
  const current = theme ?? 'system';
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-full border border-border bg-secondary p-1"
    >
      {THEMES.map(({ value, label, icon: Icon }) => (
        // biome-ignore lint/a11y/useSemanticElements: a styled radio pill; native radios cannot take this shape
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          onClick={() => setTheme(value)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors duration-200 ease-out',
            current === value
              ? 'bg-card text-accent-foreground shadow-sm'
              : 'hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The menu sheet: every destination the reader may open, one flat list per section, plus the kiosk
 * link and the theme. Radix Dialog gives it the focus trap, Escape, scroll lock and focus return to the
 * button that opened it. Dropped from the island's top edge (5rem), capped to the dynamic viewport.
 */
export function NavSheet({
  open,
  onOpenChange,
  sections,
  activeHref,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sections: readonly NavSection[];
  readonly activeHref: string | null;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-900/20 backdrop-blur-xs data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid="nav-sheet"
          aria-describedby={undefined}
          className="nav-sheet fixed inset-x-0 top-0 z-50 mx-auto w-[min(680px,92vw)] rounded-xl border border-border bg-card text-card-foreground shadow-lg duration-200 ease-out data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2"
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <DialogPrimitive.Title className="font-display text-lg font-semibold tracking-tight">
              Menu
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
              <XIcon className="size-4" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="Console" className="space-y-5">
            {sections.map((section) => (
              <div key={section.id} className="space-y-2" data-testid={`nav-section-${section.id}`}>
                <p className="eyebrow px-2">{section.label}</p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {section.items.map((item) => {
                    const current = item.href === activeHref;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => onOpenChange(false)}
                          aria-current={current ? 'page' : undefined}
                          data-testid={`nav-${item.href.slice(1).replaceAll('/', '-')}`}
                          className={cn(
                            'flex min-h-12 items-center gap-3 rounded-md px-2 py-2 transition-colors duration-200 ease-out',
                            current ? 'bg-accent' : 'hover:bg-surface-50',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'grid size-8 shrink-0 place-items-center rounded-lg',
                              current
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-accent text-accent-foreground',
                            )}
                          >
                            <NavIcon id={item.icon} className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span
                              className={cn(
                                'block text-sm font-medium',
                                current ? 'text-accent-foreground' : 'text-foreground',
                              )}
                            >
                              {item.label}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <a
              href="/kiosk"
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-accent-foreground hover:underline"
            >
              <ExternalLinkIcon className="size-4" aria-hidden="true" />
              Open kiosk
            </a>
            <ThemeSegmented />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
