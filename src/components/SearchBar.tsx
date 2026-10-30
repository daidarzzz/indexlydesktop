// src/components/SearchBar.tsx — Buscador rápido con atajo de teclado
import React, { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  query: string;
  onChange: (q: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ query, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onChange('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onChange]);

  return (
    <div className="search-wrap">
      <div className="search-icon">
        <Search size={16} />
      </div>
      <input
        ref={inputRef}
        id="search-input"
        type="text"
        placeholder="Buscar en todos los índices activos…"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="action-btn"
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: '4px',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
          }}
          title="Limpiar búsqueda"
        >
          <X size={13} />
        </button>
      ) : (
        <div className="search-hint">
          <kbd>Ctrl</kbd> + <kbd>K</kbd>
        </div>
      )}
    </div>
  );
};
