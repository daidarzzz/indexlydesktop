/**
 * @file src/ui/components/EmptyState.tsx
 * @description Estado vacío con icono, explicación, acciones y pistas.
 */

import React from 'react';
import { cn } from '../cn';

export type EmptyStateTone = 'neutral' | 'danger' | 'warning' | 'success';

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Sugerencias cortas mostradas como chips. */
  hints?: string[];
  tone?: EmptyStateTone;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actions,
  hints,
  tone = 'neutral',
  className,
  children,
  ...rest
}) => (
  <div
    className={cn('ix-empty', tone !== 'neutral' && `ix-empty--${tone}`, className)}
    {...rest}
  >
    {icon && (
      <div className="ix-empty__icon" aria-hidden="true">
        {icon}
      </div>
    )}
    <h3 className="ix-empty__title">{title}</h3>
    {description && <p className="ix-empty__description">{description}</p>}
    {children}
    {actions && <div className="ix-empty__actions">{actions}</div>}
    {hints && hints.length > 0 && (
      <div className="ix-empty__hints">
        {hints.map((hint) => (
          <span key={hint} className="ix-empty__hint">
            {hint}
          </span>
        ))}
      </div>
    )}
  </div>
);
