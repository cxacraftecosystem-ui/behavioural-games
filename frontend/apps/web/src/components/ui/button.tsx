import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one button. `default` is the purple-700 action (the only action colour); `outline` is the
 * secondary; `destructive` is outlined red and carries `data-danger`, so `ActionGroup` orders it last
 * and sets it apart. Focus is the global purple outline (globals.css), never a per-button ring.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover hover:shadow-cta disabled:bg-line-200 disabled:text-ink-500 disabled:opacity-100 disabled:shadow-none',
        destructive:
          'border border-destructive/40 bg-card text-destructive hover:border-destructive/60 hover:bg-destructive/10',
        outline:
          'border border-border bg-card text-foreground shadow-xs hover:border-purple-300 hover:bg-accent hover:text-accent-foreground dark:hover:border-purple-700',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-surface-200',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-accent-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3.5',
        sm: 'h-9 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-11 px-6 text-base has-[>svg]:px-5',
        icon: 'size-10',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-danger={variant === 'destructive' ? '' : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
