/**
 * @file src/ui/components/Field.tsx
 * @description Envoltura accesible para controles de formulario: etiqueta,
 * descripción y error conectados mediante `aria-describedby`.
 */

import React, { useId } from 'react';
import { cn } from '../cn';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode;
  /** Descripción breve bajo la etiqueta. */
  description?: React.ReactNode;
  /** Mensaje de error; sustituye a la descripción para lectores de pantalla. */
  error?: React.ReactNode;
  required?: boolean;
  /** Id del control. Si se omite se genera uno estable. */
  htmlFor?: string;
  children: React.ReactNode | ((control: FieldControlProps) => React.ReactNode);
}

export const Field: React.FC<FieldProps> = ({
  label,
  description,
  error,
  required = false,
  htmlFor,
  children,
  className,
  ...rest
}) => {
  const generatedId = useId();
  const controlId = htmlFor ?? `ix-field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  const control: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  };

  return (
    <div className={cn('ix-field', className)} {...rest}>
      <label className="ix-field__label" htmlFor={controlId}>
        {label}
        {required && (
          <span className="ix-field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {description && (
        <span className="ix-field__description" id={descriptionId}>
          {description}
        </span>
      )}
      {typeof children === 'function' ? children(control) : children}
      {error && (
        <span className="ix-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
};
