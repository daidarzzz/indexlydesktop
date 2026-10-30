// src/components/Controls.tsx — Filtros, ordenación y cambio de vista
import React, { useEffect, useState } from 'react';
import { Slot } from '../plugins/Slot';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { LayoutList, LayoutGrid } from 'lucide-react';

interface ControlsProps {
  filterLink: string | null;
  onFilterChange: (f: string | null) => void;
  sortBy: string;
  onSortChange: (s: string) => void;
  viewMode: 'list' | 'grid';
  onViewModeChange: (v: 'list' | 'grid') => void;
}

export const Controls: React.FC<ControlsProps> = ({
  filterLink,
  onFilterChange,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
}) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    return pluginRegistry.subscribe(() => setTick((t) => t + 1));
  }, []);

  const registeredViews = pluginRegistry.getRegisteredViews();
  const activeCustomView = pluginRegistry.getActiveView();

  return (
    <div className="controls">
      <div className="filter-chips">
        <button
          type="button"
          className={`chip ${filterLink === null ? 'active' : ''}`}
          onClick={() => onFilterChange(null)}
        >
          Todos
        </button>
        <button
          type="button"
          className={`chip ${filterLink === 'link' ? 'active' : ''}`}
          onClick={() => onFilterChange('link')}
        >
          Con enlace
        </button>
        <button
          type="button"
          className={`chip ${filterLink === 'nolink' ? 'active' : ''}`}
          onClick={() => onFilterChange('nolink')}
        >
          Sin enlace
        </button>
        {/* Slot para que los plugins inyecten chips de filtro dinámicos */}
        <Slot name="search_chips" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Slot name="controls_extra" />

        <select
          className="sort-select"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          title="Ordenar resultados"
        >
          <option value="relevance">Relevancia</option>
          <option value="title-asc">Título (A-Z)</option>
          <option value="title-desc">Título (Z-A)</option>
          <option value="size-desc">Tamaño (mayor)</option>
          <option value="size-asc">Tamaño (menor)</option>
        </select>

        <div className="view-toggle">
          <button
            type="button"
            className={`chip view-btn ${viewMode === 'list' && !activeCustomView ? 'active' : ''}`}
            data-view="list"
            onClick={() => {
              pluginRegistry.setActiveView(null);
              onViewModeChange('list');
            }}
            title="Vista lista compacta"
          >
            <LayoutList size={13} />
          </button>
          <button
            type="button"
            className={`chip view-btn ${viewMode === 'grid' && !activeCustomView ? 'active' : ''}`}
            data-view="grid"
            onClick={() => {
              pluginRegistry.setActiveView(null);
              onViewModeChange('grid');
            }}
            title="Vista cuadrícula con portadas"
          >
            <LayoutGrid size={13} />
          </button>

          {registeredViews.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`chip view-btn plx-view-btn ${activeCustomView?.id === v.id ? 'active' : ''}`}
              onClick={() => pluginRegistry.setActiveView(v.id)}
              title={v.label}
            >
              {v.icon ? (
                <span dangerouslySetInnerHTML={{ __html: v.icon }} />
              ) : (
                <span style={{ fontSize: '11px', fontWeight: 600 }}>{v.label.slice(0, 3).toUpperCase()}</span>
              )}
            </button>
          ))}

          <Slot name="view_modes" />
        </div>
      </div>
    </div>
  );
};
