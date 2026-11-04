// src/components/Header.tsx — Cabecera principal con icono oficial de IndexLy
import React, { useEffect, useState } from 'react';
import { Puzzle, Globe, Command } from 'lucide-react';
import { IndexlyLogo } from './IndexlyLogo';
import { Kbd } from '../ui';

interface HeaderProps {
  onOpenPlugins: () => void;
  pluginsCount: number;
  hubToken: string | null;
  onOpenHubModal: () => void;
  onOpenCommandPalette: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenPlugins,
  pluginsCount,
  hubToken,
  onOpenHubModal,
  onOpenCommandPalette,
}) => {
  // Separar visualmente la cabecera del contenido sólo cuando hay scroll
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`site-header ${isScrolled ? 'is-scrolled' : ''}`}>
      <nav className="nav">
        <a href="#" className="logo" aria-label="IndexLy inicio">
          <IndexlyLogo size={26} className="logo-img" style={{ borderRadius: '7px' }} />
          <span className="logo-text">Index<span>Ly</span></span>
        </a>

        <div className="nav-actions">
          {/* Lanzador de la paleta de comandos, con aspecto de campo de búsqueda */}
          <button
            type="button"
            className="nav-cmd"
            onClick={onOpenCommandPalette}
            aria-label="Abrir paleta de comandos"
          >
            <Command size={13} aria-hidden="true" />
            <span className="nav-cmd__text">Comandos</span>
            <Kbd keys="Ctrl+P" />
          </button>

          {/* Grupo de accesos con icono */}
          <div className="nav-group" role="group" aria-label="Herramientas">
            <button
              type="button"
              className="nav-icon"
              onClick={onOpenHubModal}
              title={hubToken ? 'IndexlyHub: conectado' : 'Conectar IndexlyHub'}
              aria-label={hubToken ? 'IndexlyHub conectado' : 'Conectar IndexlyHub'}
            >
              <Globe size={15} aria-hidden="true" />
              <span className={`nav-icon__status ${hubToken ? 'is-on' : ''}`} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`nav-icon ${pluginsCount > 0 ? 'nav-icon--wide' : ''}`}
              onClick={onOpenPlugins}
              title="Plugins"
              aria-label={`Plugins (${pluginsCount} activos)`}
            >
              <Puzzle size={15} aria-hidden="true" />
              {pluginsCount > 0 && <span className="nav-icon__count">{pluginsCount}</span>}
            </button>

            <a
              href="https://github.com/daidarzzz/indexly"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-icon"
              title="Repositorio en GitHub"
              aria-label="Repositorio en GitHub"
            >
              <GithubIcon />
            </a>
          </div>
        </div>
      </nav>
    </header>
  );
};

/** Marca de GitHub (lucide ya no incluye logos de marcas). */
const GithubIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2.02c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
  </svg>
);
