// src/components/Controls.tsx — Filtros, ordenación y cambio de vista
import React, { useEffect, useState } from 'react';
import { Slot } from '../plugins/Slot';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { LayoutList, LayoutGrid, ArrowUpDown, ChevronDown } from 'lucide-react';

interface ControlsProps {
  filterLink: string | null;
  onFilterChange: (f: string | null) => void;
  sortBy: string;
  onSortChange: (s: string) => void;
  viewMode: 'list' | 'grid';
  onViewModeChange: (v: 'list' | 'grid') => void;
}

const FILTERS: Array<{ id: string | null; label: string }> = [
  { id: null, label: 'Todos' },
  { id: 'link', label: 'Con enlace' },
  { id: 'nolink', label: 'Sin enlace' },
];

const SORTS = [
  { id: 'relevance', label: 'Relevancia' },
  { id: 'title-asc', label: 'Título (A-Z)' },
  { id: 'title-desc', label: 'Título (Z-A)' },
  { id: 'size-desc', label: 'Tamaño (mayor)' },
  { id: 'size-asc', label: 'Tamaño (menor)' },
];

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
  const activeViewId = activeCustomView?.id ?? viewMode;

  const views: Array<{ id: string; label: string; icon: React.ReactNode }> = [
    { id: 'list', label: 'Lista', icon: <LayoutList size={14} /> },
    { id: 'grid', label: 'Cuadrícula', icon: <LayoutGrid size={14} /> },
    ...registeredViews.map((v) => ({
      id: v.id,
      label: v.label,
      icon: v.icon ? (
        <span className="ctl-view__svg" dangerouslySetInnerHTML={{ __html: v.icon }} />
      ) : (
        <span className="ctl-view__abbr">{v.label.slice(0, 2).toUpperCase()}</span>
      ),
    })),
  ];

  const selectView = (id: string) => {
    if (id === 'list' || id === 'grid') {
      pluginRegistry.setActiveView(null);
      onViewModeChange(id);
      return;
    }
    pluginRegistry.setActiveView(id);
  };

  return (
    <div className="ctl-bar">
      {/* Filtros (+ chips que añadan los plugins) */}
      <div className="ctl-group ctl-filters filter-chips" role="group" aria-label="Filtrar resultados">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`chip ctl-chip ${filterLink === f.id ? 'active' : ''}`}
            aria-pressed={filterLink === f.id}
            onClick={() => onFilterChange(f.id)}
          >
            {f.label}
          </button>
        ))}
        <Slot name="search_chips" />
      </div>

      <div className="ctl-end">
        <Slot name="controls_extra" />

        {/* Ordenación: select nativo con aspecto de píldora */}
        <label className="ctl-group ctl-sort" title="Ordenar resultados">
          <ArrowUpDown size={13} aria-hidden="true" />
          <select
            className="ctl-sort__select"
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="Ordenar resultados"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="ctl-sort__chevron" aria-hidden="true" />
        </label>

        {/* Vista: sólo iconos, con su nombre como tooltip */}
        <div className="ctl-group ctl-views view-toggle" role="radiogroup" aria-label="Modo de vista de resultados">
          {views.map((v) => {
            const active = activeViewId === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={v.label}
                title={v.label}
                className={`ctl-view ${active ? 'active' : ''}`}
                onClick={() => selectView(v.id)}
              >
                {v.icon}
              </button>
            );
          })}
          <Slot name="view_modes" />
        </div>
      </div>
    </div>
  );
};
