// src/components/CommandPaletteModal.tsx — Paleta de comandos interactiva de IndexLy Desktop (Ctrl+P / Cmd+P)
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Search, Terminal, CornerDownLeft, Sparkles, X } from 'lucide-react';
import { pluginHost } from '../plugins/host/PluginHost';
import { Command } from '../plugins/types';
import { IndexlyLogo } from './IndexlyLogo';
import { IconButton, Kbd } from '../ui';

export interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDocs?: () => void;
  onOpenPlugins?: () => void;
  onOpenHub?: () => void;
  onFocusSearch?: () => void;
}

interface PaletteItem {
  id: string;
  name: string;
  category: string;
  shortcut?: string;
  icon?: string;
  execute: () => void | Promise<void>;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  onOpenDocs,
  onOpenPlugins,
  onOpenHub,
  onFocusSearch,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pluginCommands, setPluginCommands] = useState<Command[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Recargar comandos registrados al abrir
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      try {
        const cmds = pluginHost.sharedCommands.listCommands();
        setPluginCommands(cmds);
      } catch {
        setPluginCommands([]);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Lista unificada de comandos disponibles
  const allCommands = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    // 1. Comandos de plugins registrados vía app.commands.addCommand
    pluginCommands.forEach((cmd) => {
      items.push({
        id: cmd.id,
        name: cmd.name,
        category: 'Plugin',
        shortcut: cmd.defaultShortcut || 'Ctrl+P',
        execute: async () => {
          onClose();
          await pluginHost.sharedCommands.executeCommand(cmd.id);
        },
      });
    });

    // 2. Comandos esenciales del sistema IndexLy
    if (onOpenDocs) {
      items.push({
        id: 'indexly:docs',
        name: 'Documentación: Abrir Guía Completa de IndexLy',
        category: 'Sistema',
        shortcut: 'Docs',
        execute: () => {
          onClose();
          onOpenDocs();
        },
      });
    }

    if (onOpenPlugins) {
      items.push({
        id: 'indexly:plugins',
        name: 'Plugins: Abrir Gestor de Extensiones',
        category: 'Sistema',
        shortcut: 'Ctrl+Shift+P',
        execute: () => {
          onClose();
          onOpenPlugins();
        },
      });
    }

    if (onOpenHub) {
      items.push({
        id: 'indexly:hub',
        name: 'Hub: Conectar o explorar IndexLy Hub',
        category: 'Sistema',
        shortcut: 'Hub',
        execute: () => {
          onClose();
          onOpenHub();
        },
      });
    }

    if (onFocusSearch) {
      items.push({
        id: 'indexly:search',
        name: 'Buscador: Volver a la búsqueda principal',
        category: 'Sistema',
        shortcut: 'Esc',
        execute: () => {
          onClose();
          onFocusSearch();
        },
      });
    }

    return items;
  }, [pluginCommands, onClose, onOpenDocs, onOpenPlugins, onOpenHub, onFocusSearch]);

  // Filtrado reactivo en tiempo real
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [allCommands, query]);

  // Ajustar índice seleccionado cuando cambia el filtro
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Mantener el elemento seleccionado visible con scroll suave
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Manejo de teclado (flechas, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredCommands.length > 0 ? (prev + 1) % filteredCommands.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredCommands.length > 0 ? (prev - 1 + filteredCommands.length) % filteredCommands.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        selected.execute();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay command-palette-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="command-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de Comandos de IndexLy"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="command-palette-header">
          <IndexlyLogo size={20} style={{ borderRadius: "5px", flexShrink: 0, marginRight: "6px" }} />
          <Search size={16} className="command-palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Escribe un comando o busca... (ej. Bloc de Notas, Docs, Plugins)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query ? (
            <IconButton
              label="Limpiar búsqueda"
              size="sm"
              className="command-palette-clear-btn"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </IconButton>
          ) : (
            <span className="command-palette-hint">
              <Kbd>ESC</Kbd> para cerrar
            </span>
          )}
        </div>

        <div ref={listRef} className="command-palette-list" role="listbox">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`command-palette-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => cmd.execute()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="command-palette-item-main">
                    <div className="command-palette-icon-wrap">
                      {cmd.category === 'Plugin' ? (
                        <Sparkles size={14} className="text-cyan-400" />
                      ) : (
                        <Terminal size={14} className="text-gray-400" />
                      )}
                    </div>
                    <div className="command-palette-text">
                      <span className="command-palette-name">{cmd.name}</span>
                      <span className="command-palette-category">{cmd.category}</span>
                    </div>
                  </div>

                  <div className="command-palette-item-actions">
                    {cmd.shortcut && <kbd className="command-palette-kbd">{cmd.shortcut}</kbd>}
                    {isSelected && <CornerDownLeft size={13} className="command-palette-enter-icon" />}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="command-palette-empty">
              <p>No se encontraron comandos para &quot;{query}&quot;</p>
              <span>Prueba buscando &quot;Bloc de Notas&quot;, &quot;Docs&quot; o &quot;Plugins&quot;</span>
            </div>
          )}
        </div>

        <div className="command-palette-footer">
          <span className="command-palette-tip">
            <Kbd keys="↑" /> <Kbd keys="↓" /> para navegar
          </span>
          <span className="command-palette-tip">
            <Kbd keys="↵" /> para ejecutar
          </span>
          <span className="command-palette-tip">
            <Kbd keys="ESC" /> para salir
          </span>
        </div>
      </div>
    </div>
  );
};
