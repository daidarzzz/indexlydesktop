// src/components/AppSidebar.tsx — Barra lateral de la app: marca, navegación,
// fuentes y accesos (Hub, plugins, GitHub). Plegable a una tira de iconos.
import React from 'react';
import { Search, BookOpen, Globe, Puzzle, PanelLeftClose, PanelLeftOpen, Layers } from 'lucide-react';
import { IndexlyLogo } from './IndexlyLogo';

export interface SidebarNavItem {
  id: string | null;
  label: string;
  onSelect: () => void;
}

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeId: string | null;
  onSelectCore: (id: string | null) => void;
  pluginItems: SidebarNavItem[];
  /** Gestor de fuentes en su variante compacta (sólo se pinta desplegada). */
  sources: React.ReactNode;
  activeSourcesLabel: string;
  pluginsCount: number;
  onOpenPlugins: () => void;
}

/** Inicial de un plugin (respetando emojis) para la tira de iconos. */
function initialOf(label: string) {
  return (Array.from(label.trim())[0] || '?').toUpperCase();
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  collapsed,
  onToggleCollapsed,
  activeId,
  onSelectCore,
  pluginItems,
  sources,
  activeSourcesLabel,
  pluginsCount,
  onOpenPlugins,
}) => {
  const core: Array<{ id: string | null; label: string; icon: React.ReactNode }> = [
    { id: null, label: 'Buscador', icon: <Search size={15} /> },
    { id: '__hub__', label: 'Explorar Hub', icon: <Globe size={15} /> },
    { id: '__docs__', label: 'Documentación', icon: <BookOpen size={15} /> },
  ];

  return (
    <aside className={`app-sidebar ${collapsed ? 'is-rail' : ''}`} aria-label="Barra lateral">
      <div className="app-sidebar__brand">
        <a href="#" className="app-sidebar__logo" aria-label="IndexLy inicio" onClick={() => onSelectCore(null)}>
          <IndexlyLogo size={26} style={{ borderRadius: '7px' }} />
          <span className="app-sidebar__wordmark">
            Index<span>Ly</span>
          </span>
        </a>
        <button
          type="button"
          className="app-sidebar__collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Plegar barra lateral'}
          title={collapsed ? 'Expandir barra lateral' : 'Plegar barra lateral'}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <div className="app-sidebar__scroll">
        {/* Navegación principal. Conserva #plugin-tabbar y .plx-tab por compatibilidad. */}
        <nav id="plugin-tabbar" className="app-sidebar__nav" aria-label="Navegación principal">
          {core.map((item) => {
            const active = activeId === item.id;
            return (
              <button
                key={item.label}
                type="button"
                className={`plx-tab side-item ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectCore(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <span className="side-item__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="side-item__label">{item.label}</span>
              </button>
            );
          })}

          {pluginItems.length > 0 && (
            <>
              <div className="side-heading">
                <span>Plugins</span>
              </div>
              {pluginItems.map((item) => {
                const active = activeId === item.id;
                return (
                  <button
                    key={item.id ?? item.label}
                    type="button"
                    className={`plx-tab side-item side-item--plugin ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={item.onSelect}
                    title={item.label}
                  >
                    <span className="side-item__icon side-item__letter" aria-hidden="true">
                      {initialOf(item.label)}
                    </span>
                    <span className="side-item__label">{item.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </nav>

        {/* Fuentes: en la tira de iconos se resumen en un único botón */}
        {collapsed ? (
          <button
            type="button"
            className="side-item side-item--sources-rail"
            onClick={onToggleCollapsed}
            title={`Fuentes · ${activeSourcesLabel}`}
            aria-label={`Mostrar fuentes (${activeSourcesLabel})`}
          >
            <span className="side-item__icon" aria-hidden="true">
              <Layers size={15} />
            </span>
          </button>
        ) : (
          <div className="app-sidebar__sources">{sources}</div>
        )}
      </div>

      <div className="app-sidebar__foot">
        <button
          type="button"
          className="side-item"
          onClick={onOpenPlugins}
          title={collapsed ? `Plugins (${pluginsCount} activos)` : undefined}
        >
          <span className="side-item__icon" aria-hidden="true">
            <Puzzle size={15} />
          </span>
          <span className="side-item__label">Gestionar plugins</span>
          {pluginsCount > 0 && <span className="side-item__count">{pluginsCount}</span>}
        </button>

        <a
          href="https://github.com/daidarzzz/indexly"
          target="_blank"
          rel="noopener noreferrer"
          className="side-item"
          title={collapsed ? 'Repositorio en GitHub' : undefined}
        >
          <span className="side-item__icon" aria-hidden="true">
            <GithubIcon />
          </span>
          <span className="side-item__label">GitHub</span>
        </a>
      </div>
    </aside>
  );
};

/** Marca de GitHub (lucide ya no incluye logos de marcas). */
const GithubIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2.02c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
  </svg>
);
