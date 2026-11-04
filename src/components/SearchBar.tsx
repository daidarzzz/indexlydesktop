// src/components/SearchBar.tsx — Buscador rápido con atajo de teclado
import React, { useEffect, useRef } from 'react';
import { SearchInput } from '../ui';

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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <SearchInput
      ref={inputRef}
      id="search-input"
      className="search-wrap"
      placeholder="Buscar en todos los índices activos…"
      value={query}
      onChange={onChange}
      shortcut="Ctrl+K"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && document.activeElement === inputRef.current) {
          e.preventDefault();
          onChange('');
          inputRef.current?.blur();
        }
      }}
    />
  );
};
