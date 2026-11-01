'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavIcon } from '@/components/shell/nav-icon';
import { ActionGroup } from '@/components/ui/action-group';
import { navItemFor } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * The first thing on every console page, nothing above it. Title in Plus Jakarta Sans, the section's
 * icon chip (from the nav registry, so it never disagrees with the menu), one short description line,
 * and the page's buttons through `ActionGroup`. Breadcrumbs in the shell are the one way up: never add
 * a back arrow here.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  icon,
  className,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** Small line under the description (scope, audit stamp, data-layer note). */
  readonly meta?: ReactNode;
  /** Overrides the icon chip; `null` draws none. Defaults to the owning nav item's icon. */
  readonly icon?: ReactNode;
  readonly className?: string;
}) {
  const pathname = usePathname();
  const item = navItemFor(pathname ?? '');
  const fallback = item ? <NavIcon id={item.icon} className="size-5" /> : null;
  const chip = icon === undefined ? fallback : icon;
  return (
    <header
      className={cn(
        'flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {chip && (
          <div
            aria-hidden="true"
            className="mt-1 grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"
          >
            {chip}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="display-title break-words text-3xl md:text-4xl">{title}</h1>
          {description && (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          )}
          {meta && <div className="mt-3">{meta}</div>}
        </div>
      </div>
      {actions && (
        <ActionGroup align="end" className="max-sm:w-full">
          {actions}
        </ActionGroup>
      )}
    </header>
  );
}

/** Titled section within a page. Its buttons go through `ActionGroup`. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn('min-w-0 space-y-3', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && (
          <ActionGroup align="end" className="max-sm:w-full">
            {actions}
          </ActionGroup>
        )}
      </div>
      {children}
    </section>
  );
}
