'use client';

import { ChevronDownIcon, MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth/auth-context';
import { islandSlots, type NavItem, navItemFor, visibleNav } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { NavIcon } from './nav-icon';
import { NavSheet } from './nav-sheet';
import { StudySwitcher } from './study-switcher';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/** Expanded in the top 24px, compact travelling down, expanded on ANY upward scroll (±2px hysteresis). */
function useCompactOnScroll(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let previous = window.scrollY;
    const onScroll = () => {
      const latest = window.scrollY;
      if (latest < 24) setCompact(false);
      else if (latest > previous + 2) setCompact(true);
      else if (latest < previous - 2) setCompact(false);
      previous = latest;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return compact;
}

function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <Link href="/research" className="flex shrink-0 items-center gap-2.5 rounded-full pr-1">
      <span
        aria-hidden="true"
        className="grad-brand grid size-8 place-items-center rounded-full font-display text-sm font-bold text-white"
      >
        S
      </span>
      <span className="leading-tight">
        <span className="block font-display text-sm font-semibold tracking-tight">SHRIII</span>
        {!compact && (
          <span className="block text-[11px] text-muted-foreground">Behavioural Games</span>
        )}
      </span>
    </Link>
  );
}

const PILL =
  'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors duration-200 ease-out hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground';
const PILL_ACTIVE = 'bg-accent text-accent-foreground';

function GroupMenu({
  label,
  items,
  activeHref,
}: {
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly activeHref: string | null;
}) {
  const active = items.some((i) => i.href === activeHref);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(PILL, active && PILL_ACTIVE)}
        data-active={active ? 'true' : undefined}
      >
        {label}
        <ChevronDownIcon className="size-3.5 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={10} className="w-[22rem] p-2">
        {items.map((item) => {
          const current = item.href === activeHref;
          return (
            <DropdownMenuItem key={item.href} asChild className="items-start gap-3 rounded-md p-2">
              <Link href={item.href} aria-current={current ? 'page' : undefined}>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg',
                    current
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent text-accent-foreground',
                  )}
                >
                  <NavIcon id={item.icon} className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The console's navigation (skill §7). From `lg` up: a floating pill — brand, pinned links, one dropdown
 * per section, study switcher, theme, account and the menu button. Below `lg`: a slim top bar and a
 * bottom island of up to four destinations plus "More". The sheet behind the menu button is the flat
 * list of every destination and the route a keyboard or screen reader can always take.
 */
export function IslandNav() {
  const { principal } = useAuth();
  const pathname = usePathname();
  const compact = useCompactOnScroll();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sections = useMemo(() => visibleNav(principal), [principal]);
  const slots = useMemo(() => islandSlots(principal), [principal]);
  const activeHref = navItemFor(pathname)?.href ?? null;

  // A navigation always closes the sheet (adjusted during render, not in an effect, so the closed
  // sheet and the new page arrive in the same paint).
  const [sheetPath, setSheetPath] = useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setSheetOpen(false);
  }

  return (
    <>
      {/* lg and up: the floating island. */}
      <div className="nav-island-frame fixed inset-x-0 top-3 z-40 hidden justify-center px-4 lg:flex">
        <header
          data-testid="island-nav"
          data-compact={compact ? 'true' : 'false'}
          className={cn(
            'flex max-w-full items-center gap-1 rounded-full border border-border bg-card/85 shadow-island backdrop-blur-xl transition-[padding] duration-200 ease-out',
            compact ? 'px-3 py-1.5' : 'px-4 py-2',
          )}
        >
          <Brand compact={compact} />
          <span aria-hidden="true" className="mx-2 h-6 w-px bg-border" />
          <nav aria-label="Sections" className="flex items-center gap-0.5">
            {sections.map((section) => {
              const pinned = section.items.filter((i) => i.pinned);
              const grouped = section.items.filter((i) => !i.pinned);
              return [
                ...pinned.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={item.href === activeHref ? 'page' : undefined}
                    className={cn(PILL, item.href === activeHref && PILL_ACTIVE)}
                  >
                    {item.label}
                  </Link>
                )),
                grouped.length > 0 && (
                  <GroupMenu
                    key={section.id}
                    label={section.label}
                    items={grouped}
                    activeHref={activeHref}
                  />
                ),
              ];
            })}
          </nav>
          <span aria-hidden="true" className="mx-2 h-6 w-px bg-border" />
          <div className="flex items-center gap-1">
            <StudySwitcher />
            <ThemeToggle />
            <UserMenu />
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Menu"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              data-testid="menu-button"
              onClick={() => setSheetOpen(true)}
            >
              <MenuIcon />
            </Button>
          </div>
        </header>
      </div>

      {/* Below lg: a slim top bar ... */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-card/85 px-4 backdrop-blur-xl lg:hidden">
        <Brand compact />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <StudySwitcher compact />
          <UserMenu testId="user-menu-mobile" />
        </div>
      </header>

      {/* ... and the bottom island: up to four destinations, then "More". */}
      <div className="nav-island-frame fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 lg:hidden">
        <nav
          aria-label="Quick links"
          data-testid="bottom-island"
          className="flex max-w-full items-center gap-0.5 rounded-full border border-border bg-card/90 p-1.5 shadow-island backdrop-blur-xl"
        >
          {slots.map((item) => {
            const current = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground transition-colors duration-200 ease-out',
                  current ? PILL_ACTIVE : 'hover:text-foreground',
                )}
              >
                <NavIcon id={item.icon} className="size-5" />
                <span className="max-w-16 truncate">{item.label}</span>
              </Link>
            );
          })}
          <span aria-hidden="true" className="mx-1 h-8 w-px bg-border" />
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            data-testid="more-button"
            onClick={() => setSheetOpen(true)}
            className="flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground"
          >
            <MenuIcon className="size-5" aria-hidden="true" />
            More
          </button>
        </nav>
      </div>

      <NavSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        sections={sections}
        activeHref={activeHref}
      />
    </>
  );
}
