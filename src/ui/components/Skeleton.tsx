/**
 * @file src/ui/components/Skeleton.tsx
 * @description Marcador de carga con animación de brillo.
 */

import React from 'react';
import { cn } from '../cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  /** Forma del marcador. */
  shape?: 'line' | 'block' | 'circle';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  shape = 'line',
  className,
  style,
  ...rest
}) => (
  <div
    aria-hidden="true"
    className={cn('ix-skeleton', `ix-skeleton--${shape}`, className)}
    style={{
      width,
      height: height ?? (shape === 'line' ? '0.85em' : undefined),
      ...style,
    }}
    {...rest}
  />
);
