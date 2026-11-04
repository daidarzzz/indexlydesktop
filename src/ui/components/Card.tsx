/**
 * @file src/ui/components/Card.tsx
 * @description Contenedor de superficie con cabecera, cuerpo y pie composables.
 */

import React from 'react';
import { cn } from '../cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Añade realce y elevación al pasar el ratón. */
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('ix-card', interactive && 'ix-card--interactive', className)}
      {...rest}
    />
  );
});

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Acciones alineadas a la derecha. */
  actions?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  actions,
  className,
  children,
  ...rest
}) => (
  <div className={cn('ix-card__header', className)} {...rest}>
    <div className="ix-card__heading">{children}</div>
    {actions && <div className="ix-card__actions">{actions}</div>}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...rest
}) => <h3 className={cn('ix-card__title', className)} {...rest} />;

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className,
  ...rest
}) => <p className={cn('ix-card__description', className)} {...rest} />;

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...rest
}) => <div className={cn('ix-card__body', className)} {...rest} />;

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...rest
}) => <div className={cn('ix-card__footer', className)} {...rest} />;
