/**
 * @file src/ui/components/Layout.tsx
 * @description Primitivas de layout basadas en los tokens de espaciado.
 */

import React from 'react';
import { cn } from '../cn';

export type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12 | 16;

function gapValue(gap: SpaceStep | undefined): string | undefined {
  if (gap === undefined) return undefined;
  return gap === 0 ? '0' : `var(--space-${gap})`;
}

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: SpaceStep;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
}

export const Stack: React.FC<StackProps> = ({
  gap = 3,
  align,
  justify,
  className,
  style,
  ...rest
}) => (
  <div
    className={cn('ix-stack', className)}
    style={{ gap: gapValue(gap), alignItems: align, justifyContent: justify, ...style }}
    {...rest}
  />
);

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: SpaceStep;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
  /** `false` desactiva el salto de línea. */
  wrap?: boolean;
}

export const Inline: React.FC<InlineProps> = ({
  gap = 2,
  align,
  justify,
  wrap = true,
  className,
  style,
  ...rest
}) => (
  <div
    className={cn('ix-inline', className)}
    style={{
      gap: gapValue(gap),
      alignItems: align,
      justifyContent: justify,
      flexWrap: wrap ? 'wrap' : 'nowrap',
      ...style,
    }}
    {...rest}
  />
);

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: SpaceStep;
  /** Número de columnas o plantilla CSS completa. */
  columns?: number | string;
  /** Ancho mínimo para columnas auto-ajustables. */
  minItemWidth?: string;
}

export const Grid: React.FC<GridProps> = ({
  gap = 3,
  columns,
  minItemWidth = '220px',
  className,
  style,
  ...rest
}) => {
  const template =
    typeof columns === 'number'
      ? `repeat(${columns}, minmax(0, 1fr))`
      : (columns ?? `repeat(auto-fit, minmax(${minItemWidth}, 1fr))`);
  return (
    <div
      className={cn('ix-grid', className)}
      style={{ gap: gapValue(gap), gridTemplateColumns: template, ...style }}
      {...rest}
    />
  );
};
