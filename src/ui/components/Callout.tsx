/**
 * @file src/ui/components/Callout.tsx
 * @description Bloque de aviso contextual con icono y tono semántico.
 */

import React from 'react';
import { Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../cn';

export type CalloutVariant = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

const defaultIcons: Record<CalloutVariant, React.ReactNode> = {
  info: <Info size={15} />,
  warning: <AlertTriangle size={15} />,
  danger: <XCircle size={15} />,
  success: <CheckCircle2 size={15} />,
  neutral: <Info size={15} />,
};

export interface CalloutProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: CalloutVariant;
  title?: React.ReactNode;
  /** Sustituye el icono por defecto. Pasa `null` para ocultarlo. */
  icon?: React.ReactNode;
}

export const Callout: React.FC<CalloutProps> = ({
  variant = 'neutral',
  title,
  icon,
  className,
  children,
  ...rest
}) => {
  const resolvedIcon = icon === undefined ? defaultIcons[variant] : icon;
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'note'}
      className={cn('ix-callout', variant !== 'neutral' && `ix-callout--${variant}`, className)}
      {...rest}
    >
      {resolvedIcon !== null && (
        <span className="ix-callout__icon" aria-hidden="true">
          {resolvedIcon}
        </span>
      )}
      <div className="ix-callout__content">
        {title && <strong className="ix-callout__title">{title}</strong>}
        {children}
      </div>
    </div>
  );
};
