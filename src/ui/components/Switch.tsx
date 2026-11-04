/**
 * @file src/ui/components/Switch.tsx
 * @description Interruptor accesible basado en `role="switch"`.
 */

import React from 'react';
import { cn } from '../cn';

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Etiqueta accesible; obligatoria si no hay texto asociado visible. */
  label?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, className, disabled, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cn('ix-switch', className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      {...rest}
    >
      <span className="ix-switch__knob" aria-hidden="true" />
    </button>
  );
});
