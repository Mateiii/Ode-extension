import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        [
          'flex min-h-11 w-full rounded-lg',
          'border border-[var(--color-border-light)] bg-[var(--color-white)]',
          'px-3 py-2 text-sm text-[var(--color-ink)]',
          'outline-none transition-[border-color,box-shadow] duration-[120ms]',
          'placeholder:text-[var(--color-faint)]',
          'focus-visible:border-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-ochre)]/15',
          'disabled:cursor-not-allowed disabled:opacity-[0.55]',
        ].join(' '),
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
