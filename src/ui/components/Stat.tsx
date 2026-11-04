/**
 * @file src/ui/components/Stat.tsx
 * @description Métrica compacta con etiqueta, valor y pista opcional.
 */

import React from 'react';
import { cn } from '../cn';

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
}

export const Stat: React.FC<StatProps> = ({ label, value, hint, className, ...rest }) => (
  <div className={cn('ix-stat', className)} {...rest}>
    <span className="ix-stat__label">{label}</span>
    <span className="ix-stat__value">{value}</span>
    {hint != null && <span className="ix-stat__hint">{hint}</span>}
  </div>
);
