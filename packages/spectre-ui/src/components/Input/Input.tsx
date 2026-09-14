import React, { forwardRef, InputHTMLAttributes, ReactNode, useState } from 'react';
import './Input.css';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Label for the input */
  label?: string;
  /** Helper text displayed below the input */
  helperText?: string;
  /** Error message (also sets error state) */
  error?: string;
  /** The size of the input */
  size?: InputSize;
  /** Icon or element to display at the start */
  leftElement?: ReactNode;
  /** Icon or element to display at the end */
  rightElement?: ReactNode;
  /** Whether the input should take full width */
  fullWidth?: boolean;
}

/**
 * Input component for text entry with support for labels, errors, and icons.
 * 
 * @example
 * ```tsx
 * <Input 
 *   label="Token Address" 
 *   placeholder="Enter address..."
 *   error={errors.address}
 * />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      helperText,
      error,
      size = 'md',
      leftElement,
      rightElement,
      fullWidth = false,
      disabled,
      className = '',
      id,
      type = 'text',
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const inputId = id || `spectre-input-${Math.random().toString(36).substr(2, 9)}`;
    const isPassword = type === 'password';
    const inputType = isPassword && showPassword ? 'text' : type;

    const wrapperClasses = [
      'spectre-input-wrapper',
      fullWidth && 'spectre-input-wrapper--full-width',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const containerClasses = [
      'spectre-input-container',
      `spectre-input-container--${size}`,
      error && 'spectre-input-container--error',
      disabled && 'spectre-input-container--disabled',
      leftElement && 'spectre-input-container--has-left',
      (rightElement || isPassword) && 'spectre-input-container--has-right',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={wrapperClasses}>
        {label && (
          <label htmlFor={inputId} className="spectre-input-label">
            {label}
          </label>
        )}
        <div className={containerClasses}>
          {leftElement && (
            <span className="spectre-input-element spectre-input-element--left">
              {leftElement}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            disabled={disabled}
            className="spectre-input"
            aria-invalid={!!error}
            aria-describedby={
              error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
            }
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              className="spectre-input-element spectre-input-element--right spectre-input-toggle"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          )}
          {rightElement && !isPassword && (
            <span className="spectre-input-element spectre-input-element--right">
              {rightElement}
            </span>
          )}
        </div>
        {error && (
          <span id={`${inputId}-error`} className="spectre-input-error" role="alert">
            {error}
          </span>
        )}
        {helperText && !error && (
          <span id={`${inputId}-helper`} className="spectre-input-helper">
            {helperText}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
