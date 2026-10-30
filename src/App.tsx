// src/App.tsx — Aplicación principal IndexLy Desktop
import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, BookOpen } from 'lucide-react';
import { Header } from './components/Header';
import { SourceManager } from './components/SourceManager';
import { SearchBar } from './components/SearchBar';
import { Controls } from './components/Controls';
import { ResultsView } from './components/ResultsView';
import { PluginModal } from './components/PluginModal';
import { HubConnectModal } from './components/HubConnectModal';
import { DocsView } from './components/DocsView';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { pluginHost } from './plugins/host/PluginHost';
import { WorkspaceLeaf } from './plugins/types';
import { pluginRegistry, SectionDefinition } from './plugins/PluginRegistry';
import { LoadedPlugin, SearchResult, Source, ToastItem } from './types';

export function App() {
  const isSpotlightWindow = typeof window !== 'undefined' && window.location.search.includes('window=spotlight');

  const [sources, setSources] = useState<Source[]>([]);
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [isHubModalOpen, setIsHubModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [workspaceLeaves, setWorkspaceLeaves] = useState<WorkspaceLeaf[]>([]);

  useEffect(() => {
    if (isSpotlightWindow) {
      document.documentElement.classList.add('spotlight-window');
      document.body.classList.add('spotlight-window');
    }
  }, [isSpotlightWindow]);

  // Secciones registradas por plugins (p. ej. ReadLy)
  const [sections, setSections] = useState<SectionDefinition[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const sectionBodyRef = useRef<HTMLDivElement | null>(null);

  // Hub Token
  const [hubToken, setHubToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('indexly_hub_token') || null;
    } catch {
      return null;
    }
  });

  // Estado de búsqueda
  const [query, setQuery] = useState('');
  const [filterLink, setFilterLink] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('relevance');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // Resultados de búsqueda
  const [searchResult, setSearchResult] = useState<SearchResult>({
    items: [],
    total: 0,
    active_sources_count: 0,
    total_items_count: 0,
    took_ms: 0,
  });

  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((text: string, type: 'success' | 'warning' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Conectar sistema de toasts al plugin registry
  useEffect(() => {
    pluginRegistry.setToastHandler(showToast);
  }, [showToast]);

  // Sincronizar fuentes con el registro de plugins
  useEffect(() => {
    pluginRegistry.setSources(sources);
  }, [sources]);

  // Escuchar secciones registradas por plugins
  useEffect(() => {
    const unsub = pluginRegistry.subscribe(() => {
      setSections(pluginRegistry.getSections());
    });
    setSections(pluginRegistry.getSections());
    return unsub;
  }, []);

  // Escuchar hojas y vistas del espacio de trabajo moderno (WorkspaceLeaves de Plugin API v1)
  useEffect(() => {
    const updateLeaves = () => {
      setWorkspaceLeaves(pluginHost.sharedWorkspace.getLeaves());
    };
    const u1 = pluginHost.sharedEvents.on('workspace:layout-change', updateLeaves);
    const u2 = pluginHost.sharedEvents.on('workspace:leaf:reveal', ({ leaf }: any) => {
      if (leaf?.view) {
        setActiveSectionId(leaf.view.getViewType());
      }
      updateLeaves();
    });
    updateLeaves();
    return () => {
      pluginHost.sharedEvents.off(u1);
      pluginHost.sharedEvents.off(u2);
    };
  }, []);

  // Helpers globales para control de secciones y modales por plugins
  useEffect(() => {
    (window as any).closePluginModal = () => {
      const modalEl = document.getElementById('plugin-modal');
      const bodyEl = document.getElementById('plugin-modal-body');
      const actionsEl = document.getElementById('plugin-modal-actions');
      if (modalEl) {
        modalEl.classList.remove('open');
        modalEl.style.display = 'none';
        modalEl.setAttribute('aria-hidden', 'true');
      }
      if (bodyEl) bodyEl.innerHTML = '';
      if (actionsEl) actionsEl.innerHTML = '';
    };

    (window as any).pluginOpenSection = (id: string) => {
      const found = pluginRegistry.getSections().find((s) => s.id === id);
      if (found) {
        setActiveSectionId(id);
        return true;
      }
      return false;
    };

    (window as any).pluginCloseSection = () => {
      setActiveSectionId(null);
    };

    (window as any).pluginShowSection = (id: string) => {
      if (id === '__search__' || activeSectionId === id) {
        setActiveSectionId(null);
      } else {
        setActiveSectionId(id);
      }
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 1. Interceptar Ctrl+P o Cmd+P para la Paleta de Comandos (previene impresión nativa del navegador)
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        e.stopPropagation();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // 2. Interceptar Ctrl+K como atajo alternativo estándar
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        e.stopPropagation();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
          return;
        }
        const modalEl = document.getElementById('plugin-modal');
        if (modalEl && modalEl.style.display !== 'none') {
          (window as any).closePluginModal();
        } else if (activeSectionId === '__docs__') {
          setActiveSectionId(null);
        } else if (activeSectionId) {
          setActiveSectionId(null);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeSectionId, isCommandPaletteOpen]);

  // Renderizar la sección activa en su contenedor DOM (para legacy sections y modern WorkspaceLeaves)
  useEffect(() => {
    if (activeSectionId && sectionBodyRef.current) {
      if (activeSectionId === '__docs__') return;

      // 1. Comprobar si es una hoja de espacio de trabajo moderna (ej. ScratchpadView)
      const leaf = workspaceLeaves.find((l) => l.view && l.view.getViewType() === activeSectionId);
      if (leaf && leaf.view) {
        sectionBodyRef.current.innerHTML = '';
        sectionBodyRef.current.appendChild(leaf.view.containerEl);
        if (typeof (leaf.view as any).refresh === 'function') {
          (leaf.view as any).refresh();
        }
        return;
      }

      // 2. Comprobar si es una sección registrada legacy
      const sec = sections.find((s) => s.id === activeSectionId);
      if (sec) {
        sectionBodyRef.current.innerHTML = '';
        try {
          sec.render(sectionBodyRef.current);
        } catch (err) {
          console.error('[Plugin Section Error]:', err);
        }
      }
    }
  }, [activeSectionId, sections, workspaceLeaves]);

  // Cargar fuentes desde Rust
  const loadSources = useCallback(async () => {
    try {
      const list = await invoke<Source[]>('get_sources');
      setSources(list);
    } catch (err) {
      console.error('Error cargando fuentes:', err);
    }
  }, []);

  // Cargar plugins desde Rust
  const loadPlugins = useCallback(async () => {
    try {
      const list = await invoke<LoadedPlugin[]>('get_plugins');
      setPlugins(list);
      await pluginRegistry.loadPlugins(list);
    } catch (err) {
      console.error('Error cargando plugins:', err);
    }
  }, []);

  // Reaccionar a eventos de fuentes emitidos por plugins
  useEffect(() => {
    const u1 = pluginRegistry.on('sources:changed', () => loadSources());
    const u2 = pluginRegistry.on('source:toggled', () => loadSources());
    const u3 = pluginRegistry.on('source:deleted', () => loadSources());
    return () => {
      u1();
      u2();
      u3();
    };
  }, [loadSources]);

  // Referencia al controlador de cancelación de búsqueda en vuelo (Solución a Bug 1)
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  // Ejecutar búsqueda en SQLite FTS5 vía Rust con soporte de Pipeline Middleware y cancelación cooperativa
  const executeSearch = useCallback(
    async (
      q: string,
      fl: string | null,
      sb: string,
      currentOffset: number = 0,
      append: boolean = false,
      signal?: AbortSignal
    ) => {
      try {
        if (signal?.aborted) return;
        pluginRegistry.setQuery(q);
        const queryCtx = await pluginRegistry.runPipeline('search:query', {
          query: q,
          filterLink: fl,
          sortBy: sb,
          limit,
          offset: currentOffset,
        });

        if (signal?.aborted) return;

        let res = await invoke<SearchResult>('search_items', {
          query: queryCtx.query,
          filterLink: queryCtx.filterLink,
          sortBy: queryCtx.sortBy,
          limit: queryCtx.limit,
          offset: queryCtx.offset,
        });

        if (signal?.aborted) return;

        res = await pluginRegistry.runPipeline('search:results', {
          ...res,
          query: queryCtx.query,
        });

        if (signal?.aborted) return;

        if (append) {
          setSearchResult((prev) => ({
            ...res,
            items: [...prev.items, ...res.items],
          }));
        } else {
          setSearchResult(res);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) {
          return;
        }
        console.error('Error en búsqueda:', err);
      }
    },
    [limit]
  );

  // Búsqueda con debounce cancelable (100 ms) y AbortController (Solución a Bug 1)
  const searchTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    // 1. Cancelar cualquier timeout previo
    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    // 2. Abortar cualquier petición en vuelo anterior
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    searchTimeoutRef.current = window.setTimeout(() => {
      setOffset(0);
      executeSearch(query, filterLink, sortBy, 0, false, controller.signal);
    }, 100);

    return () => {
      if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
      controller.abort();
    };
  }, [query, filterLink, sortBy, executeSearch]);

  // Inicialización
  useEffect(() => {
    loadSources();
    loadPlugins();
  }, [loadSources, loadPlugins]);

  // Importar archivo (soporta paquetes y sobres v2 de IndexLy)
  const handleImportFile = async (name: string, content: string) => {
    try {
      const newSources = await invoke<Source[]>('import_file', {
        name,
        content,
        mapping: null,
      });

      if (newSources.length === 1) {
        showToast(
          `Fuente "${newSources[0].name}" importada (${newSources[0].count.toLocaleString('es-ES')} elementos)`,
          'success'
        );
      } else {
        const totalItems = newSources.reduce((acc, s) => acc + s.count, 0);
        showToast(
          `Paquete "${name}" importado con ${newSources.length} subcarpetas (${totalItems.toLocaleString('es-ES')} elementos)`,
          'success'
        );
      }

      await loadSources();
      executeSearch(query, filterLink, sortBy, 0, false);
    } catch (err: any) {
      showToast(`Error al importar: ${err}`, 'error');
    }
  };

  // Alternar fuente activa
  const handleToggleSource = async (id: string, active: boolean) => {
    try {
      await invoke('toggle_source', { id, active });
      await loadSources();
      executeSearch(query, filterLink, sortBy, 0, false);
    } catch (err: any) {
      showToast(`Error al cambiar estado: ${err}`, 'error');
    }
  };

  // Eliminar fuente
  const handleDeleteSource = async (id: string) => {
    try {
      await invoke('delete_source', { id });
      showToast('Fuente eliminada', 'success');
      await loadSources();
      executeSearch(query, filterLink, sortBy, 0, false);
    } catch (err: any) {
      showToast(`Error al eliminar: ${err}`, 'error');
    }
  };

  // Alternar paquete completo
  const handleTogglePackage = async (slug: string, active: boolean) => {
    try {
      await invoke('toggle_package', { slug, active });
      await loadSources();
      executeSearch(query, filterLink, sortBy, 0, false);
      showToast(active ? `Paquete "${slug}" activado` : `Paquete "${slug}" desactivado`, 'success');
    } catch (err: any) {
      showToast(`Error al alternar paquete: ${err}`, 'error');
    }
  };

  // Eliminar paquete completo
  const handleDeletePackage = async (slug: string) => {
    try {
      await invoke('delete_package', { slug });
      await loadSources();
      executeSearch(query, filterLink, sortBy, 0, false);
      showToast(`Paquete "${slug}" eliminado`, 'success');
    } catch (err: any) {
      showToast(`Error al eliminar paquete: ${err}`, 'error');
    }
  };

  // Alternar plugin (se persiste en backend; la UI se recarga de forma limpia al salir del modal)
  const handleTogglePlugin = async (id: string, enabled: boolean) => {
    try {
      await invoke('toggle_plugin', { id, enabled });
      const updatedList = await invoke<LoadedPlugin[]>('get_plugins');
      setPlugins(updatedList);
      pluginRegistry.teardownPlugin(id);
      await pluginRegistry.loadPlugins(updatedList);
    } catch (err: any) {
      showToast(`Error al alternar plugin: ${err}`, 'error');
    }
  };

  // Guardar Token del Hub
  const handleSaveHubToken = async (token: string): Promise<boolean> => {
    try {
      const res = await fetch('https://indexlyhub.daida.net/api/v1/favorites', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return false;
      if (!res.ok) throw new Error(`El Hub respondió con código ${res.status}`);

      setHubToken(token);
      localStorage.setItem('indexly_hub_token', token);
      showToast('Conectado a IndexlyHub con éxito', 'success');
      return true;
    } catch (err: any) {
      throw err;
    }
  };

  const handleDisconnectHub = () => {
    setHubToken(null);
    localStorage.removeItem('indexly_hub_token');
    showToast('Desconectado de IndexlyHub', 'info');
  };

  // Cargar más
  const handleLoadMore = () => {
    const nextOffset = offset + limit;
    setOffset(nextOffset);
    executeSearch(query, filterLink, sortBy, nextOffset, true);
  };

  if (isSpotlightWindow) {
    return <div id="spotlight-window-root" style={{ width: '100%', height: '100%' }} />;
  }

  return (
    <div className="App">
      <Header
        onOpenPlugins={() => setIsPluginModalOpen(true)}
        pluginsCount={plugins.filter((p) => p.manifest.enabled).length}
        hubToken={hubToken}
        onOpenHubModal={() => setIsHubModalOpen(true)}
        onOpenDocs={() => setActiveSectionId((curr) => (curr === '__docs__' ? null : '__docs__'))}
        isDocsActive={activeSectionId === '__docs__'}
      />

      <main className={`Search ${activeSectionId ? 'section-open' : ''}`}>
        {/* Tabbar de secciones principales y plugins */}
        <div id="plugin-tabbar" className="plugin-tabbar" role="group" aria-label="Navegación principal">
          <button
            type="button"
            className={`plx-tab ${!activeSectionId ? 'active' : ''}`}
            aria-pressed={!activeSectionId}
            onClick={() => setActiveSectionId(null)}
          >
            <Search size={13} style={{ marginRight: '6px', verticalAlign: '-1px' }} />
            <span>Buscador</span>
          </button>

          <button
            type="button"
            className={`plx-tab ${activeSectionId === '__docs__' ? 'active' : ''}`}
            aria-pressed={activeSectionId === '__docs__'}
            onClick={() => setActiveSectionId('__docs__')}
          >
            <BookOpen size={13} style={{ marginRight: '6px', verticalAlign: '-1px' }} />
            <span>Documentación</span>
          </button>

          {sections.map((sec) => (
            <button
              key={sec.id}
              type="button"
              className={`plx-tab ${activeSectionId === sec.id ? 'active' : ''}`}
              aria-pressed={activeSectionId === sec.id}
              onClick={() => setActiveSectionId(sec.id)}
            >
              {sec.label}
            </button>
          ))}

          {/* Vistas y hojas del espacio de trabajo moderno (Plugin API v1) */}
          {workspaceLeaves.map((leaf) => {
            if (!leaf.view) return null;
            const viewType = leaf.view.getViewType();
            const displayText = leaf.view.getDisplayText() || 'Vista';
            const isActive = activeSectionId === viewType;
            return (
              <button
                key={leaf.id}
                type="button"
                className={`plx-tab ${isActive ? 'active' : ''}`}
                aria-pressed={isActive}
                onClick={() => {
                  setActiveSectionId(viewType);
                  pluginHost.sharedWorkspace.revealLeaf(leaf);
                }}
              >
                <span>{displayText}</span>
              </button>
            );
          })}

          <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <div className="indexly-ribbon-bar" id="indexly-ribbon-bar" />
          </div>
        </div>

        {/* Vista integrada de Documentación (Pestaña) */}
        {activeSectionId === '__docs__' && (
          <DocsView onClose={() => setActiveSectionId(null)} />
        )}

        <SourceManager
          sources={sources}
          plugins={plugins}
          onImportFile={handleImportFile}
          onToggleSource={handleToggleSource}
          onDeleteSource={handleDeleteSource}
          onTogglePackage={handleTogglePackage}
          onDeletePackage={handleDeletePackage}
          onRefreshSources={loadSources}
          onRefreshPlugins={loadPlugins}
          showToast={showToast}
          hubToken={hubToken}
          onOpenHubModal={() => setIsHubModalOpen(true)}
        />

        {/* Contenedor de sección de plugin activa (ReadLy, etc.) */}
        <div
          id="plugin-sections"
          className="plugin-sections"
          style={{ display: activeSectionId && activeSectionId !== '__docs__' ? 'block' : 'none' }}
          aria-live="polite"
        >
          <div className="plx-section-head">
            <button type="button" className="plx-btn plx-btn-sec" onClick={() => setActiveSectionId(null)}>
              ← Volver a la búsqueda
            </button>
          </div>
          <div ref={sectionBodyRef} className="plx-section-body" />
        </div>

        <SearchBar query={query} onChange={setQuery} />

        <Controls
          filterLink={filterLink}
          onFilterChange={setFilterLink}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        <ResultsView
          items={searchResult.items}
          total={searchResult.total}
          totalItemsCount={searchResult.total_items_count}
          activeSourcesCount={searchResult.active_sources_count}
          tookMs={searchResult.took_ms}
          viewMode={viewMode}
          onLoadMore={handleLoadMore}
          hasMore={searchResult.items.length < searchResult.total}
        />
      </main>

      {/* Modal genérico para plugins (invocado vía ctx.modal) */}
      <div
        id="plugin-modal"
        className="modal-overlay plugin-modal-overlay"
        aria-hidden="true"
        onClick={(e) => {
          if (e.target === e.currentTarget && (window as any).closePluginModal) {
            (window as any).closePluginModal();
          }
        }}
      >
        <div
          className="modal-dialog plugin-modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plugin-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header plugin-modal-header">
            <h4 id="plugin-modal-title">—</h4>
            <button
              type="button"
              className="modal-close"
              onClick={() => (window as any).closePluginModal && (window as any).closePluginModal()}
              aria-label="Cerrar modal"
            >
              ✕
            </button>
          </div>
          <div id="plugin-modal-body" className="modal-body plugin-modal-body" />
          <div id="plugin-modal-actions" className="modal-actions plugin-modal-actions" />
        </div>
      </div>

      <PluginModal
        isOpen={isPluginModalOpen}
        onClose={() => setIsPluginModalOpen(false)}
        plugins={plugins}
        onTogglePlugin={handleTogglePlugin}
      />

      <HubConnectModal
        isOpen={isHubModalOpen}
        onClose={() => setIsHubModalOpen(false)}
        token={hubToken}
        onSaveToken={handleSaveHubToken}
        onDisconnect={handleDisconnectHub}
      />

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type || 'success'}`}>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Barra de estado reactiva unificada (Plugin API v1) */}
      <footer className="indexly-status-bar" id="indexly-status-bar" />

      {/* Paleta de Comandos Interactiva (Ctrl+P / Cmd+P / Ctrl+K) */}
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenDocs={() => setActiveSectionId('__docs__')}
        onOpenPlugins={() => setIsPluginModalOpen(true)}
        onOpenHub={() => setIsHubModalOpen(true)}
        onFocusSearch={() => setActiveSectionId(null)}
      />
    </div>
  );
}

export default App;

