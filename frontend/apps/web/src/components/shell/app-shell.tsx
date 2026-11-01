'use client';

import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';
import { breadcrumbs } from '@/lib/nav';
import { DemoBanner } from './demo-banner';
import { IslandNav } from './island-nav';
import { PasswordChangeBanner } from './password-change-banner';

/** The one way up a level. Shown only when there is somewhere to go (two or more crumbs). */
function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = breadcrumbs(pathname);
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((c, i) => (
          <Fragment key={c.href}>
            {i > 0 && (
              <li aria-hidden="true">
                <ChevronRightIcon className="size-3.5 opacity-60" />
              </li>
            )}
            <li className="max-w-[16rem] truncate">
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="rounded-sm hover:text-accent-foreground">
                  {c.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Console chrome (skill §6.2): skip link, the island nav, and the page frame. `lg:pt-24` is the island
 * clearance contract; below `lg` the top padding clears the 56px top bar and the bottom padding clears
 * the bottom island. Never add top or bottom padding of your own for the nav.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-60 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-md"
      >
        Skip to content
      </a>
      <IslandNav />
      <main
        id="main"
        tabIndex={-1}
        key={pathname}
        className="console-main mx-auto w-full max-w-7xl px-4 pt-[calc(3.5rem+1.25rem)] pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:pt-24 lg:pb-12"
      >
        <DemoBanner />
        <PasswordChangeBanner />
        <Breadcrumbs />
        {children}
      </main>
    </div>
  );
}
