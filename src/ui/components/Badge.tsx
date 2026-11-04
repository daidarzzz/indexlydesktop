/**
 * @file src/ui/components/Badge.tsx
 * @description Etiqueta compacta de estado o metadato.
 */

import React from 'react';
import { cn } from '../cn';

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Punto de color a la izquierda. */
  dot?: boolean;
  /** Tipografía monoespaciada para identificadores y conteos. */
  mono?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  dot = false,
  mono = false,
  className,
  children,
  ...rest
}) => (
  <span
    className={cn(
      'ix-badge',
      variant !== 'neutral' && `ix-badge--${variant}`,
      mono && 'ix-badge--mono',
      className,
    )}
    {...rest}
  >
    {dot && <span className="ix-badge__dot" aria-hidden="true" />}
    {children}
  </span>
);
