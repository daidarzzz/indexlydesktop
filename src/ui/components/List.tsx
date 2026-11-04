/**
 * @file src/ui/components/List.tsx
 * @description Lista vertical y sus elementos, con soporte de interacción.
 */

import React from 'react';
import { cn } from '../cn';

export interface ListProps extends React.HTMLAttributes<HTMLUListElement> {}

export const List: React.FC<ListProps> = ({ className, ...rest }) => (
  <ul className={cn('ix-list', className)} {...rest} />
);

export interface ListItemProps extends Omit<React.LiHTMLAttributes<HTMLLIElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  interactive?: boolean;
}

export const ListItem: React.FC<ListItemProps> = ({
  title,
  description,
  leading,
  trailing,
  interactive = false,
  className,
  children,
  onClick,
  onKeyDown,
  ...rest
}) => {
  const clickable = interactive || Boolean(onClick);
  return (
    <li
      className={cn('ix-list-item', clickable && 'ix-list-item--interactive', className)}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !clickable) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      {...rest}
    >
      {leading && <span className="ix-list-item__leading">{leading}</span>}
      <span className="ix-list-item__content">
        {title && <span className="ix-list-item__title">{title}</span>}
        {description && <span className="ix-list-item__description">{description}</span>}
        {children}
      </span>
      {trailing && <span className="ix-list-item__trailing">{trailing}</span>}
    </li>
  );
};
