/**
 * @file src/ui/components/SearchInput.tsx
 * @description Buscador compuesto: icono, atajo de teclado, limpieza y foco.
 */

import React, { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../cn';
import { IconButton } from './IconButton';
import { Kbd } from './Kbd';

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  value: string;
  onChange: (value: string) => void;
  /** Atajo mostrado a la derecha, p. ej. `Ctrl+K`. */
  shortcut?: string;
  /** Se invoca al pulsar Escape o el botón de limpiar. */
  onClear?: () => void;
  /** Etiqueta accesible del botón de limpiar. */
  clearLabel?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onChange,
      shortcut,
      onClear,
      clearLabel = 'Limpiar búsqueda',
      placeholder = 'Buscar…',
      className,
      onKeyDown,
      ...rest
    },
    ref,
  ) {
    const localRef = useRef<HTMLInputElement>(null);
    const setRef = (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    const clear = () => {
      onChange('');
      onClear?.();
      localRef.current?.focus();
    };

    return (
      <div className={cn('ix-search', className)}>
        <span className="ix-input-wrap__leading ix-search__icon" aria-hidden="true">
          <Search size={16} />
        </span>
        <input
          ref={setRef}
          type="search"
          role="searchbox"
          value={value}
          placeholder={placeholder}
          className={cn('ix-input', 'ix-search__input')}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key === 'Escape' && value) {
              event.preventDefault();
              clear();
            }
          }}
          {...rest}
        />
        {value ? (
          <IconButton
            label={clearLabel}
            size="sm"
            className="ix-search__clear"
            onClick={clear}
          >
            <X size={14} />
          </IconButton>
        ) : (
          shortcut && (
            <span className="ix-search__hint" aria-hidden="true">
              <Kbd keys={shortcut} />
            </span>
          )
        )}
      </div>
    );
  },
);
