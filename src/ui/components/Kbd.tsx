/**
 * @file src/ui/components/Kbd.tsx
 * @description Representación visual de una tecla o combinación de teclado.
 */

import React from 'react';
import { cn } from '../cn';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Combinación separada por `+`; se renderiza como teclas independientes. */
  keys?: string;
}

export const Kbd: React.FC<KbdProps> = ({ keys, className, children, ...rest }) => {
  if (keys) {
    const parts = keys.split('+').map((part) => part.trim()).filter(Boolean);
    return (
      <span className={cn('ix-kbd-group', className)} {...rest}>
        {parts.map((part, index) => (
          <React.Fragment key={`${part}-${index}`}>
            {index > 0 && <span className="ix-kbd-group__sep">+</span>}
            <kbd className="ix-kbd">{part}</kbd>
          </React.Fragment>
        ))}
      </span>
    );
  }
  return (
    <kbd className={cn('ix-kbd', className)} {...rest}>
      {children}
    </kbd>
  );
};
