// src/components/SourceManager.tsx — Gestor de Fuentes de IndexLy con subcarpetas y pestañas
import React, { useState, useEffect } from 'react';
import { Source, SourceActionConfig, LoadedPlugin } from '../types';
import { HubExplorer } from './HubExplorer';
import { MappingModal } from './MappingModal';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { Folder, Upload, Trash2, ChevronDown, ChevronRight, Globe, Layers, Settings } from 'lucide-react';

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

function getSourceAvatarStyle(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 45) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h1}, 75%, 45%), hsl(${h2}, 85%, 28%))`,
    color: '#ffffff',
  };
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

  const renderPillActions = (s: Source) => (
    <div className="index-pill-actions">
      <button
        type="button"
        className="action-btn map"
        onClick={() => setEditingSource(s)}
        title="Ajustar fuente"
        aria-label={`Ajustar ${s.name}`}
      >
        <Settings size={13} />
      </button>

      {sourceActions
        .filter((a) => !a.match || a.match(s))
        .map((a) => (
          <button
            key={`${a.pluginId}-${a.id}`}
            type="button"
            className="action-btn map"
            onClick={() => a.onClick(s)}
            title={a.label}
            aria-label={`${a.label}: ${s.name}`}
          >
            {a.short || a.label}
          </button>
        ))}

      <button
        type="button"
        className="index-switch"
        role="switch"
        aria-checked={s.active}
        onClick={() => onToggleSource(s.id, !s.active)}
        title={s.active ? 'Desactivar fuente' : 'Activar fuente'}
      >
        <span className="knob" />
      </button>

      <button
        type="button"
        className="action-btn delete"
        onClick={() => onDeleteSource(s.id)}
        title="Eliminar fuente"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );

  return (
    <div
      className={`index-manager-card ${dragOver ? 'drag-over' : ''} ${collapsed ? 'is-collapsed' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className={`manager-header ${collapsed ? 'header-collapsed' : ''}`}>
        <div className="manager-title">
          <div className="manager-icon">
            <Folder size={collapsed ? 14 : 16} />
          </div>
          <div>
            <h3>
              Fuentes guardadas
              <span className="fuentes-count">{sources.length}</span>
            </h3>
            <p className="manager-desc">Formatos: JSON, Envelopes v2, CSV, TSV, TXT</p>
          </div>
        </div>

        <div className="manager-actions">
          <label className="file-label">
            <Upload size={13} />
            <span>Añadir archivo</span>
            <input
              type="file"
              multiple
              accept=".json,.csv,.tsv,.txt"
              onChange={handleFileInput}
              style={{ display: 'none' }}
            />
          </label>
          <button
            type="button"
            className="action-btn secondary"
            onClick={handleToggleCollapsed}
            title={collapsed ? 'Expandir' : 'Plegar'}
            style={{ width: '28px', height: '28px', padding: 0, display: 'grid', placeItems: 'center' }}
          >
            <ChevronDown size={14} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Pestañas estilo IndexLy: Fuentes / Hub */}
          <div className="src-tabs">
            <button
              type="button"
              className={`src-tab ${activeTab === 'fuentes' ? 'active' : ''}`}
              onClick={() => setActiveTab('fuentes')}
            >
              <Layers size={13} />
              <span>Mis Fuentes</span>
              <span className="src-count">{sources.length}</span>
            </button>
            <button
              type="button"
              className={`src-tab ${activeTab === 'hub' ? 'active' : ''}`}
              onClick={() => setActiveTab('hub')}
            >
              <Globe size={13} />
              <span>Explorar Hub</span>
              <span className={`src-dot ${hubToken ? 'on' : ''}`} />
            </button>
          </div>

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
                <div className="drop-hint">
                  Arrastra y suelta aquí tus archivos o pulsa en <strong>Añadir archivo</strong>
                </div>
              ) : (
                <div className="indexes-grid-list">
                  {order.map((entry) => {
                    if (entry.type === 'single') {
                      const s = entry.source;
                      const initial = s.name.charAt(0).toUpperCase();
                      return (
                        <div key={s.id} className={`index-pill ${s.active ? 'active' : 'inactive'}`}>
                          <div className="index-pill-info">
                            <div className="index-avatar" style={getSourceAvatarStyle(s.name)}>
                              {initial}
                            </div>
                            <div className="index-text">
                              <strong>{s.name}</strong>
                              <small>
                                {s.count.toLocaleString('es-ES')} elementos
                                {s.mapping && <span className="mapped-badge">mapeado</span>}
                              </small>
                            </div>
                          </div>

                          {renderPillActions(s)}
                        </div>
                      );
                    }

                    // Grupo de paquete (Subcarpeta)
                    const g = groups.get(entry.slug);
                    if (!g) return null;
                    if (g.items.length <= 1) {
                      const s = g.items[0];
                      const initial = s.name.charAt(0).toUpperCase();
                      return (
                        <div key={s.id} className={`index-pill ${s.active ? 'active' : 'inactive'}`}>
                          <div className="index-pill-info">
                            <div className="index-avatar" style={getSourceAvatarStyle(s.name)}>
                              {initial}
                            </div>
                            <div className="index-text">
                              <strong>{s.name}</strong>
                              <small>
                                {s.count.toLocaleString('es-ES')} elementos
                                {s.mapping && <span className="mapped-badge">mapeado</span>}
                              </small>
                            </div>
                          </div>

                          {renderPillActions(s)}
                        </div>
                      );
                    }

                    const isPkgCollapsed = collapsedPackages[entry.slug] ?? true;
                    const totalItems = g.items.reduce((acc, i) => acc + i.count, 0);
                    const allActive = g.items.every((i) => i.active);
                    const noneActive = g.items.every((i) => !i.active);

                    return (
                      <div key={entry.slug} className={`pkg-group ${isPkgCollapsed ? 'collapsed' : ''}`}>
                        {/* Cabecera de la subcarpeta / paquete */}
                        <div
                          className={`index-pill pkg-header ${noneActive ? 'inactive' : 'active'}`}
                          style={{
                            background: '#0c1322',
                            borderColor: 'var(--color-primary-border)',
                            cursor: 'pointer',
                          }}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('.index-pill-actions, .index-switch, .action-btn')) return;
                            togglePackageCollapse(entry.slug);
                          }}
                        >
                          <button
                            type="button"
                            className="pkg-chevron"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePackageCollapse(entry.slug);
                            }}
                            title={isPkgCollapsed ? 'Expandir carpeta' : 'Plegar carpeta'}
                          >
                            {isPkgCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          </button>

                          <div className="index-pill-info">
                            <div className="index-avatar" style={getSourceAvatarStyle(g.name)}>
                              <Folder size={18} />
                            </div>
                            <div className="index-text">
                              <strong>{g.name}</strong>
                              <small>
                                {g.items.length} fuentes · {totalItems.toLocaleString('es-ES')} elementos
                                {noneActive ? ' · desactivado' : ''}
                              </small>
                            </div>
                          </div>

                          <div className="index-pill-actions">
                            <button
                              type="button"
                              className="index-switch"
                              role="switch"
                              aria-checked={allActive}
                              onClick={() => onTogglePackage(entry.slug, !allActive)}
                              title={allActive ? 'Desactivar paquete completo' : 'Activar paquete completo'}
                            >
                              <span className="knob" />
                            </button>

                            <button
                              type="button"
                              className="action-btn delete"
                              onClick={() => onDeletePackage(entry.slug)}
                              title="Eliminar paquete completo"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Fuentes hijas dentro de la carpeta */}
                        {!isPkgCollapsed && (
                          <div className="pkg-children">
                            {g.items.map((child) => {
                              const initial = child.name.charAt(0).toUpperCase();
                              return (
                                <div
                                  key={child.id}
                                  className={`index-pill ${child.active ? 'active' : 'inactive'}`}
                                  style={{ padding: '8px 10px' }}
                                >
                                  <div className="index-pill-info">
                                    <div
                                      className="index-avatar"
                                      style={{
                                        ...getSourceAvatarStyle(child.name),
                                        width: '32px',
                                        height: '32px',
                                        fontSize: '13px',
                                      }}
                                    >
                                      {initial}
                                    </div>
                                    <div className="index-text">
                                      <strong style={{ fontSize: '13px' }}>{child.name}</strong>
                                      <small>
                                        {child.count.toLocaleString('es-ES')} elementos
                                        {child.mapping && <span className="mapped-badge">mapeado</span>}
                                      </small>
                                    </div>
                                  </div>

                                  {renderPillActions(child)}
                                </div>
                              );
                            })}
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
    </div>
  );
};
