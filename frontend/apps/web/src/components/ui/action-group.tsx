import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export type ActionAlign = 'start' | 'center' | 'end';
export type ActionLayout = 'none' | 'single' | 'pair' | 'stack';

/** One button is centred, two share one line, three or more stack on a phone and are pills from `sm`. */
export function actionGroupLayout(count: number): ActionLayout {
  if (count <= 0) return 'none';
  if (count === 1) return 'single';
  if (count === 2) return 'pair';
  return 'stack';
}

function isDanger(element: ReactElement): boolean {
  const props = element.props as { readonly 'data-danger'?: unknown; readonly variant?: unknown };
  return props['data-danger'] !== undefined || props.variant === 'destructive';
}

/** Direct children with fragments looked through, `null` / `false` / text dropped, danger last. */
export function actionChildren(children: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        walk((child.props as { readonly children?: ReactNode }).children);
        return;
      }
      out.push(child);
    });
  };
  walk(children);
  const safe = out.filter((el) => !isDanger(el));
  const danger = out.filter(isDanger);
  return [...safe, ...danger].map((el, i) => cloneElement(el, { key: el.key ?? `action-${i}` }));
}

/*
 * The layout is decided by CSS from the RENDERED children, not by counting React elements: a `<Can>`
 * that renders nothing leaves no DOM child, so a row of two permission-gated buttons where the reader
 * holds one permission is laid out as one centred button, never as half a line.
 *
 * Complete literal class strings: Tailwind scans source text, so an interpolated class emits no CSS.
 */
const BASE =
  'flex flex-wrap items-center justify-center gap-2 empty:hidden [&>[data-danger]]:order-last sm:[&>[data-danger]]:ml-2';
/** Exactly two, phone: one line, equal halves, a long label wraps inside its button. */
const PAIR =
  'max-sm:has-[>:nth-child(2):last-child]:grid max-sm:has-[>:nth-child(2):last-child]:grid-cols-2 max-sm:has-[>:nth-child(2):last-child]:[&>*]:h-auto max-sm:has-[>:nth-child(2):last-child]:[&>*]:min-h-10 max-sm:has-[>:nth-child(2):last-child]:[&>*]:min-w-0 max-sm:has-[>:nth-child(2):last-child]:[&>*]:whitespace-normal';
/** Three or more: stacked full width on a phone, one row of pills from `sm`. */
const STACK =
  'max-sm:has-[>:nth-child(3)]:flex-col max-sm:has-[>:nth-child(3)]:items-stretch sm:has-[>:nth-child(3)]:[&>*]:rounded-full';
/** Two or more from `sm`: placed at `align`. A lone button stays centred. */
const MULTI_ALIGN: Record<ActionAlign, string> = {
  start: 'sm:has-[>:nth-child(2)]:justify-start',
  center: '',
  end: 'sm:has-[>:nth-child(2)]:justify-end',
};
/** `inline` (a table cell or list row): every count follows `align`, so a column of actions lines up. */
const INLINE_ALIGN: Record<ActionAlign, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
};

/**
 * Every row of buttons goes through this (skill §19.2).
 *
 * | Buttons | Phone (< sm, 640px)                        | sm and up                          |
 * | 1       | centred (`fill` spans the line)            | centred                            |
 * | 2       | one line, equal halves; labels wrap inside | one line, content width, `align`   |
 * | 3+      | stacked, full width                        | one row of pills, wraps if it must |
 *
 * A destructive child (`variant="destructive"`, or anything carrying `data-danger`) goes last and is
 * set apart. Not for toolbars, toggles, selects, segmented tabs or pagers: those are plain
 * `flex flex-wrap gap-2` rows with a one-line comment saying so.
 */
export function ActionGroup({
  children,
  align = 'end',
  inline = false,
  fill = false,
  className,
}: {
  readonly children?: ReactNode;
  readonly align?: ActionAlign;
  readonly inline?: boolean;
  readonly fill?: boolean;
  readonly className?: string | undefined;
}) {
  const items = actionChildren(children);
  if (items.length === 0) return null;
  return (
    <div
      data-slot="action-group"
      className={cn(
        `${BASE} ${PAIR} ${STACK}`,
        inline ? INLINE_ALIGN[align] : MULTI_ALIGN[align],
        fill && '[&>:only-child]:w-full',
        className,
      )}
    >
      {items}
    </div>
  );
}
