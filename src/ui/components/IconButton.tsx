/**
 * @file src/ui/components/IconButton.tsx
 * @description Botón compacto solo-icono con etiqueta accesible obligatoria.
 */

import React from 'react';
import { cn } from '../cn';

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Etiqueta accesible; se usa como `aria-label` y `title` si no hay title. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn('ix-icon-btn', `ix-icon-btn--${variant}`, `ix-icon-btn--${size}`, className)}
        aria-label={label}
        title={rest.title ?? label}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
