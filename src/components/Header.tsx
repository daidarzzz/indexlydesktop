// src/components/Header.tsx — Cabecera principal idéntica a IndexLy
import React from 'react';
import { Puzzle, Globe, ExternalLink } from 'lucide-react';

interface HeaderProps {
  onOpenPlugins: () => void;
  pluginsCount: number;
  hubToken: string | null;
  onOpenHubModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenPlugins,
  pluginsCount,
  hubToken,
  onOpenHubModal,
}) => {
  return (
    <header className="site-header">
      <nav className="nav">
        <a href="#" className="logo" aria-label="IndexLy Desktop inicio">
          <span className="logo-text">Index<span>Ly</span></span>
        </a>

        <div className="nav-actions">
          <button
            type="button"
            className="nav-btn"
            onClick={onOpenHubModal}
            title={hubToken ? 'Conectado a IndexlyHub' : 'Conectar tu API de IndexlyHub'}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: hubToken ? '#22c55e' : '#64748b',
                boxShadow: hubToken ? '0 0 0 2px rgba(34, 197, 94, 0.25)' : 'none',
              }}
            />
            <Globe size={13} />
            <span>{hubToken ? 'Hub Conectado' : 'Conectar Hub'}</span>
          </button>

          <button
            type="button"
            className="nav-btn"
            onClick={onOpenPlugins}
            title="Gestor de extensiones y plugins"
          >
            <Puzzle size={13} />
            <span>Plugins</span>
            {pluginsCount > 0 && <span className="fuentes-count">{pluginsCount}</span>}
          </button>

          <a
            href="https://github.com/daidarzzz/indexly"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-btn"
          >
            <span>GitHub</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </nav>
    </header>
  );
};
