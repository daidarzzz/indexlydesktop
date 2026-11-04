/**
 * @file src/ui/components/Checkbox.tsx
 * @description Casilla nativa estilizada con etiqueta opcional.
 */

import React from 'react';
import { cn } from '../cn';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, ...rest },
  ref,
) {
  return (
    <label className={cn('ix-checkbox', className)}>
      <input ref={ref} type="checkbox" {...rest} />
      {(label || description) && (
        <span className="ix-checkbox__content">
          {label && <span className="ix-checkbox__label">{label}</span>}
          {description && <span className="ix-checkbox__description">{description}</span>}
        </span>
      )}
    </label>
  );
});
