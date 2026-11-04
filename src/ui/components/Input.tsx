/**
 * @file src/ui/components/Input.tsx
 * @description Campos de texto, área de texto y selector nativo estilizados.
 */

import React from 'react';
import { cn } from '../cn';

export type ControlSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  controlSize?: ControlSize;
  invalid?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { controlSize = 'md', invalid = false, leadingIcon, trailingIcon, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'ix-input',
        controlSize !== 'md' && `ix-input--${controlSize}`,
        leadingIcon ? 'ix-input--with-leading' : undefined,
        trailingIcon ? 'ix-input--with-trailing' : undefined,
        className,
      )}
      {...rest}
    />
  );

  if (!leadingIcon && !trailingIcon) return input;

  return (
    <span className="ix-input-wrap">
      {leadingIcon && (
        <span className="ix-input-wrap__leading" aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      {input}
      {trailingIcon && (
        <span className="ix-input-wrap__trailing">{trailingIcon}</span>
      )}
    </span>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn('ix-input', 'ix-textarea', className)}
      {...rest}
    />
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  controlSize?: ControlSize;
  invalid?: boolean;
  options?: SelectOption[];
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    controlSize = 'md',
    invalid = false,
    options,
    placeholder,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'ix-input',
        'ix-select',
        controlSize !== 'md' && `ix-input--${controlSize}`,
        className,
      )}
      {...rest}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options
        ? options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))
        : children}
    </select>
  );
});
