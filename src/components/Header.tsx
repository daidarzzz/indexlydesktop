// src/components/Header.tsx — Barra superior de la zona principal: buscador (o el
// título de la sección abierta), lanzador de comandos y ribbon de plugins.
import React, { useEffect, useState } from 'react';
import { Command } from 'lucide-react';
import { Kbd } from '../ui';

interface HeaderProps {
  /** Contenido de la izquierda: el buscador o el título de la sección. */
  children: React.ReactNode;
  onOpenCommandPalette: () => void;
}

export const Header: React.FC<HeaderProps> = ({ children, onOpenCommandPalette }) => {
  // Separar visualmente la barra del contenido sólo cuando hay scroll
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`app-topbar ${isScrolled ? 'is-scrolled' : ''}`}>
      <div className="app-topbar__main">{children}</div>

      <div className="app-topbar__end">
        {/* Botones que registran los plugins (Plugin API v1) */}
        <div className="indexly-ribbon-bar" id="indexly-ribbon-bar" />

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
      </div>
    </header>
  );
};
