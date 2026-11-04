/**
 * @file src/ui/components/Divider.tsx
 * @description Separador horizontal o vertical.
 */

import React from 'react';
import { cn } from '../cn';

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical';
}

export const Divider: React.FC<DividerProps> = ({
  orientation = 'horizontal',
  className,
  ...rest
}) => (
  <hr
    aria-orientation={orientation}
    className={cn('ix-divider', orientation === 'vertical' && 'ix-divider--vertical', className)}
    {...rest}
  />
);
