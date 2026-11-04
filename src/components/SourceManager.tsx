// src/components/SourceManager.tsx — Gestor de Fuentes de IndexLy con subcarpetas y pestañas
import React, { useState, useEffect } from 'react';
import { Source, SourceActionConfig, LoadedPlugin } from '../types';
import { HubExplorer } from './HubExplorer';
import { MappingModal } from './MappingModal';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { Folder, Upload, Trash2, ChevronDown, ChevronRight, Globe, Layers, Settings, Plus } from 'lucide-react';
import { IconButton, Switch } from '../ui';

interface SourceManagerProps {
  sources: Source[];
  plugins?: LoadedPlugin[];
  onImportFile: (name: string, content: string) => Promise<void>;
  onToggleSource: (id: string, active: boolean) => Promise<void>;
  onDeleteSource: (id: string) => Promise<void>;
  onTogglePackage: (slug: string, active: boolean) => Promise<void>;
  onDeletePackage: (slug: string) => Promise<void>;
  onRefreshSources: () => Promise<void>;
  onRefreshPlugins?: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
  hubToken: string | null;
  onOpenHubModal: () => void;
}

/** Degradado estable por nombre (mismo tono que en los resultados). */
function avatarStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return { background: `linear-gradient(135deg, hsl(${h1}, 70%, 32%), hsl(${h2}, 80%, 18%))` };
}

const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u;

/**
 * Avatar de una fuente. Si el nombre empieza por un emoji (p. ej. "🧲 Torrents")
 * se usa ese emoji como avatar y se quita del texto; si no, la inicial.
 * Evita `charAt(0)`, que parte los emojis en dos y muestra "�".
 */
function getAvatar(name: string): { emoji: string | null; initial: string; label: string } {
  const match = name.match(LEADING_EMOJI);
  if (match) {
    const label = name.slice(match[0].length).trim() || name;
    return { emoji: match[1], initial: '', label };
  }
  const first = Array.from(name.trim())[0] || '?';
  return { emoji: null, initial: first.toUpperCase(), label: name };
}

export const SourceManager: React.FC<SourceManagerProps> = ({
  sources,
  plugins = [],
  onImportFile,
  onToggleSource,
  onDeleteSource,
  onTogglePackage,
  onDeletePackage,
  onRefreshSources,
  onRefreshPlugins,
  showToast,
  hubToken,
  onOpenHubModal,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('indexly_fuentes_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<'fuentes' | 'hub'>('fuentes');
  const [collapsedPackages, setCollapsedPackages] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('indexly_pkg_collapsed');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [sourceActions, setSourceActions] = useState<SourceActionConfig[]>(pluginRegistry.getSourceActions());

  useEffect(() => {
    return pluginRegistry.subscribe(() => {
      setSourceActions(pluginRegistry.getSourceActions());
    });
  }, []);

  useEffect(() => {
    if (editingSource) {
      const fresh = sources.find((s) => s.id === editingSource.id);
      if (fresh) setEditingSource(fresh);
    }
  }, [sources]);

  const handleToggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('indexly_fuentes_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  const togglePackageCollapse = (slug: string) => {
    setCollapsedPackages((prev) => {
      // Por defecto la carpeta está cerrada (true) si no está en el mapa
      const isCurrentlyCollapsed = prev[slug] ?? true;
      const updated = {
        ...prev,
        [slug]: !isCurrentlyCollapsed,
      };
      try {
        localStorage.setItem('indexly_pkg_collapsed', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      await onImportFile(file.name, text);
    }
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      await onImportFile(file.name, text);
    }
  };

  const activeSources = sources.filter((s) => s.active).length;
  const totalElements = sources.reduce((acc, s) => acc + s.count, 0);

  // Agrupar fuentes por paquete (subcarpetas)
  const groups = new Map<string, { name: string; items: Source[] }>();
  const order: ({ type: 'single'; source: Source } | { type: 'group'; slug: string })[] = [];

  for (const source of sources) {
    const slug = source.pkg?.slug;
    if (!slug) {
      order.push({ type: 'single', source });
      continue;
    }
    if (!groups.has(slug)) {
      const pkgName = source.pkg?.name || slug;
      groups.set(slug, { name: pkgName, items: [] });
      order.push({ type: 'group', slug });
    }
    groups.get(slug)!.items.push(source);
  }

  // Fila de una fuente (suelta o dentro de una carpeta)
  const renderSourceRow = (s: Source, isChild = false) => {
    const avatar = getAvatar(s.name);
    return (
      <div
        key={s.id}
        role="listitem"
        className={`src-row ${isChild ? 'src-row--child' : ''} ${s.active ? '' : 'is-inactive'}`}
      >
        <div
          className={`src-row__avatar ${avatar.emoji ? 'src-row__avatar--emoji' : ''}`}
          style={avatar.emoji ? undefined : avatarStyle(s.name)}
          aria-hidden="true"
        >
          {avatar.emoji ?? avatar.initial}
        </div>

        <div className="src-row__text">
          <strong title={s.name}>{avatar.label}</strong>
          <small>
            {s.count.toLocaleString('es-ES')} elementos
            {s.mapping && <span className="src-row__tag">mapeado</span>}
          </small>
        </div>

        <div className="src-row__actions">
          <IconButton
            label={`Ajustar ${s.name}`}
            size="sm"
            className="src-row__hover-btn"
            onClick={() => setEditingSource(s)}
          >
            <Settings size={13} />
          </IconButton>

          {sourceActions
            .filter((a) => !a.match || a.match(s))
            .map((a) => (
              <button
                key={`${a.pluginId}-${a.id}`}
                type="button"
                className="action-btn map src-row__hover-btn"
                onClick={() => a.onClick(s)}
                title={a.label}
                aria-label={`${a.label}: ${s.name}`}
              >
                {a.short || a.label}
              </button>
            ))}

          <IconButton
            label={`Eliminar ${s.name}`}
            size="sm"
            variant="danger"
            className="src-row__hover-btn"
            onClick={() => onDeleteSource(s.id)}
          >
            <Trash2 size={13} />
          </IconButton>

          <Switch
            checked={s.active}
            onCheckedChange={(next) => onToggleSource(s.id, next)}
            label={s.active ? 'Desactivar fuente' : 'Activar fuente'}
            title={s.active ? 'Desactivar fuente' : 'Activar fuente'}
          />
        </div>
      </div>
    );
  };

  return (
    <section
      className={`index-manager-card srcm ${dragOver ? 'drag-over' : ''} ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Gestor de fuentes"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Ignorar el dragleave al pasar sobre elementos hijos
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {/* Cabecera: título + resumen a la izquierda; pestañas y acciones a la derecha */}
      <header className="srcm__head">
        <button
          type="button"
          className="srcm__title"
          onClick={handleToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expandir gestor de fuentes' : 'Plegar gestor de fuentes'}
        >
          <span className="srcm__icon" aria-hidden="true">
            <Layers size={15} />
          </span>
          <span className="srcm__titles">
            <span className="srcm__name">Fuentes</span>
            <span className="srcm__summary">
              {sources.length === 0
                ? 'Sin fuentes todavía'
                : `${activeSources}/${sources.length} activas · ${totalElements.toLocaleString('es-ES')} elementos`}
            </span>
          </span>
          <ChevronDown size={14} className="srcm__chevron" aria-hidden="true" />
        </button>

        <div className="srcm__actions">
          {!collapsed && (
            <div className="srcm__tabs" role="tablist" aria-label="Secciones del gestor de fuentes">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'fuentes'}
                className={`srcm__tab ${activeTab === 'fuentes' ? 'active' : ''}`}
                onClick={() => setActiveTab('fuentes')}
              >
                Mis fuentes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'hub'}
                className={`srcm__tab ${activeTab === 'hub' ? 'active' : ''}`}
                onClick={() => setActiveTab('hub')}
                title={hubToken ? 'IndexlyHub conectado' : 'IndexlyHub sin conectar'}
              >
                <Globe size={12} aria-hidden="true" />
                Hub
                <span className={`srcm__hub-dot ${hubToken ? 'is-on' : ''}`} aria-hidden="true" />
              </button>
            </div>
          )}

          <label className="srcm__add" title="Añadir archivo (JSON, Envelopes v2, CSV, TSV, TXT)">
            <Plus size={14} aria-hidden="true" />
            <span>Añadir</span>
            <input
              type="file"
              multiple
              accept=".json,.csv,.tsv,.txt"
              onChange={handleFileInput}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </header>

      {/* Capa visible mientras se arrastran archivos encima de la tarjeta */}
      {dragOver && (
        <div className="srcm__drop-overlay" aria-hidden="true">
          <Upload size={18} />
          <span>Suelta para importar</span>
        </div>
      )}

      {!collapsed && (
        <>

          {activeTab === 'hub' ? (
            <HubExplorer
              hubToken={hubToken}
              onOpenConnectModal={onOpenHubModal}
              onRefreshSources={onRefreshSources}
              onRefreshPlugins={onRefreshPlugins}
              plugins={plugins}
              sources={sources}
              showToast={showToast}
            />
          ) : (
            <>
              {sources.length === 0 ? (
                <div className="srcm__empty">
                  <span className="srcm__empty-icon" aria-hidden="true">
                    <Upload size={18} />
                  </span>
                  <strong>Arrastra aquí tus índices</strong>
                  <span>o pulsa <b>Añadir</b> · JSON, Envelopes v2, CSV, TSV, TXT</span>
                </div>
              ) : (
                <div className="src-list" role="list">
                  {order.map((entry) => {
                    if (entry.type === 'single') {
                      return renderSourceRow(entry.source);
                    }

                    // Grupo de paquete (subcarpeta)
                    const g = groups.get(entry.slug);
                    if (!g) return null;
                    if (g.items.length <= 1) return renderSourceRow(g.items[0]);

                    const isPkgCollapsed = collapsedPackages[entry.slug] ?? true;
                    const totalItems = g.items.reduce((acc, i) => acc + i.count, 0);
                    const activeCount = g.items.filter((i) => i.active).length;
                    const allActive = activeCount === g.items.length;
                    const noneActive = activeCount === 0;
                    const pkgAvatar = getAvatar(g.name);

                    return (
                      <div
                        key={entry.slug}
                        className={`src-pkg ${isPkgCollapsed ? 'is-collapsed' : 'is-open'} ${noneActive ? 'is-inactive' : ''}`}
                        role="listitem"
                      >
                        {/* Cabecera de la carpeta: toda la fila pliega/despliega */}
                        <div
                          className="src-row src-row--pkg"
                          role="button"
                          tabIndex={0}
                          aria-expanded={!isPkgCollapsed}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('.src-row__actions')) return;
                            togglePackageCollapse(entry.slug);
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                              e.preventDefault();
                              togglePackageCollapse(entry.slug);
                            }
                          }}
                        >
                          <ChevronRight size={14} className="src-row__chevron" aria-hidden="true" />

                          <div className="src-row__avatar src-row__avatar--folder" style={avatarStyle(g.name)} aria-hidden="true">
                            {pkgAvatar.emoji ?? <Folder size={16} />}
                          </div>

                          <div className="src-row__text">
                            <strong title={g.name}>{pkgAvatar.label}</strong>
                            <small>
                              {g.items.length} fuentes · {totalItems.toLocaleString('es-ES')} elementos
                            </small>
                          </div>

                          <div className="src-row__actions">
                            {!allActive && !noneActive && (
                              <span className="src-row__partial" title={`${activeCount} de ${g.items.length} fuentes activas`}>
                                {activeCount}/{g.items.length}
                              </span>
                            )}
                            <IconButton
                              label={`Eliminar paquete ${g.name}`}
                              size="sm"
                              variant="danger"
                              className="src-row__hover-btn"
                              onClick={() => onDeletePackage(entry.slug)}
                            >
                              <Trash2 size={13} />
                            </IconButton>
                            <Switch
                              checked={allActive}
                              onCheckedChange={(next) => onTogglePackage(entry.slug, next)}
                              label={allActive ? 'Desactivar paquete completo' : 'Activar paquete completo'}
                              title={allActive ? 'Desactivar paquete completo' : 'Activar paquete completo'}
                            />
                          </div>
                        </div>

                        {/* Fuentes hijas, con línea de árbol */}
                        {!isPkgCollapsed && (
                          <div className="src-pkg__children" role="list">
                            {g.items.map((child) => renderSourceRow(child, true))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {editingSource && (
        <MappingModal
          source={editingSource}
          onClose={() => setEditingSource(null)}
          onSaved={onRefreshSources}
          showToast={showToast}
        />
      )}
    </section>
  );
};
