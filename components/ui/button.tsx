import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold',
    'transition-[background-color,border-color,color] duration-[120ms]',
    'disabled:pointer-events-none disabled:opacity-[0.55]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ochre)] focus-visible:ring-offset-2',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'bg-[var(--color-ochre)] text-[var(--color-white)]',
          'hover:bg-[var(--color-ochre-hover)]',
        ].join(' '),
        outline: [
          'border border-[var(--color-border-light)] bg-[var(--color-white)] text-[var(--color-muted)]',
          'hover:bg-[var(--color-hover-bg)] hover:border-[var(--color-border)] hover:text-[var(--color-ink)]',
        ].join(' '),
        ghost: [
          'text-[var(--color-faint)]',
          'hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-ink)]',
        ].join(' '),
      },
      size: {
        default: 'h-9 px-3',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
