/**
 * @file src/ui/components/Modal.tsx
 * @description Diálogo modal con portal, bloqueo de scroll, cierre por Escape
 * y trampa de foco básica.
 */

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { IconButton } from './IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: ModalSize;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** Cierra al hacer clic fuera del diálogo. */
  closeOnOverlay?: boolean;
  /** Cierra con la tecla Escape. */
  closeOnEscape?: boolean;
  showClose?: boolean;
  /** Etiqueta accesible cuando no hay título visible. */
  ariaLabel?: string;
  className?: string;
  bodyClassName?: string;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  closeOnOverlay = true,
  closeOnEscape = true,
  showClose = true,
  ariaLabel,
  className,
  bodyClassName,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.classList.add('ix-modal-open');

    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? dialog).focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.classList.remove('ix-modal-open');
      restoreFocusRef.current?.focus?.();
    };
  }, [open, closeOnEscape, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const hasHeader = Boolean(title || description || showClose);

  return createPortal(
    <div
      className="ix-modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={!title ? ariaLabel : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn('ix-modal', `ix-modal--${size}`, className)}
      >
        {hasHeader && (
          <div className="ix-modal__header">
            <div className="ix-modal__heading">
              {title && (
                <h2 className="ix-modal__title" id={titleId}>
                  {title}
                </h2>
              )}
              {description && (
                <p className="ix-modal__description" id={descriptionId}>
                  {description}
                </p>
              )}
            </div>
            {showClose && (
              <IconButton
                label="Cerrar"
                size="sm"
                className="ix-modal__close"
                onClick={onClose}
              >
                <X size={15} />
              </IconButton>
            )}
          </div>
        )}
        <div className={cn('ix-modal__body', bodyClassName)}>{children}</div>
        {footer && <div className="ix-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};
