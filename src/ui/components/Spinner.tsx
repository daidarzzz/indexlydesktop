/**
 * @file src/ui/components/Spinner.tsx
 * @description Indicador de carga circular accesible.
 */

import React from 'react';
import { cn } from '../cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /** Texto accesible para lectores de pantalla. */
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  label = 'Cargando',
  className,
  ...rest
}) => (
  <span
    role="status"
    aria-label={label}
    className={cn('ix-spinner', `ix-spinner--${size}`, className)}
    {...rest}
  />
);
