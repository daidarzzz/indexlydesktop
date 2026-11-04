/**
 * @file src/ui/components/Button.tsx
 * @description Botón de la biblioteca de IndexLy. Variantes y tamaños alineados
 * con el diseño existente (pill, superficie oscura, acento cian).
 */

import React from 'react';
import { cn } from '../cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Muestra un spinner y deshabilita la interacción. */
  loading?: boolean;
  /** Ocupa todo el ancho disponible. */
  block?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

/**
 * Botón estándar. Mantiene `type="button"` por defecto para evitar envíos
 * accidentales de formularios, salvo que se indique lo contrario.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    iconLeft,
    iconRight,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'ix-btn',
        `ix-btn--${variant}`,
        `ix-btn--${size}`,
        block && 'ix-btn--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" className="ix-btn__spinner" />
      ) : (
        iconLeft && <span className="ix-btn__icon">{iconLeft}</span>
      )}
      {children}
      {iconRight && <span className="ix-btn__icon">{iconRight}</span>}
    </button>
  );
});
