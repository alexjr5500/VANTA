'use client';

import React, { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: ReactNode;
  rightIcon?: ReactNode;
  onRightIconClick?: () => void;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, icon, rightIcon, onRightIconClick, className, id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="form-label">
            {label}
          </label>
        )}
        <div className="relative group">
          {icon && (
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[#d6a83f]/60 transition-colors duration-200">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'form-input',
              icon && 'pl-10',
              rightIcon && 'pr-12',
              error && 'border-red-500/30 focus:border-red-500/40 focus:shadow-[0_0_0_1px_rgba(239,68,68,0.1)]',
              className
            )}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
            {...props}
          />
          {rightIcon && (
            <button
              type="button"
              onClick={onRightIconClick}
              className={cn(
                'absolute right-3.5 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors',
                onRightIconClick ? 'cursor-pointer' : 'cursor-default'
              )}
              tabIndex={onRightIconClick ? 0 : -1}
              aria-label={props['aria-label'] as string || 'Input action'}
            >
              {rightIcon}
            </button>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-red-400 text-xs mt-1" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="text-white/30 text-xs mt-1">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;