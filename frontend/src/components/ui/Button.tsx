'use client';

import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'gold' | 'goldGhost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  children?: ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'btn-primary',
  secondary:
    'btn-secondary',
  ghost:
    'btn-ghost',
  danger:
    'inline-flex items-center justify-center gap-2 font-semibold rounded-[var(--radius-button)] px-5 py-3 text-sm bg-red-500/90 text-white hover:bg-red-500 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
  outline:
    'inline-flex items-center justify-center gap-2 font-medium rounded-[var(--radius-button)] px-5 py-3 text-sm border border-white/10 bg-transparent text-white/80 hover:border-white/20 hover:bg-white/[.04] hover:text-white transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
  gold:
    'btn-gold',
  goldGhost:
    'btn-gold-ghost',
  destructive:
    'btn-destructive',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 py-2 text-xs gap-1.5 rounded-[var(--radius-button)]',
  md: 'min-h-11 px-5 py-2.5 text-sm gap-2 rounded-[var(--radius-button)]',
  lg: 'min-h-12 px-6 py-3 text-sm gap-2.5 rounded-[var(--radius-button)]',
  xl: 'min-h-14 px-8 py-3.5 text-base gap-3 rounded-[var(--radius-button)]',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      icon,
      iconPosition = 'left',
      children,
      className = '',
      fullWidth = false,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && 'w-full',
          isDisabled && 'opacity-50 cursor-not-allowed hover:translate-y-0',
          className
        )}
        aria-disabled={isDisabled}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <span
            className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin shrink-0"
            aria-hidden="true"
          />
        )}
        {!loading && icon && iconPosition === 'left' && (
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}
        {children && <span>{children}</span>}
        {!loading && icon && iconPosition === 'right' && (
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;