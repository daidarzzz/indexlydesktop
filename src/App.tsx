// src/App.tsx — Aplicación principal IndexLy Desktop
import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft } from 'lucide-react';

import { Header } from './components/Header';
import { SourceManager } from './components/SourceManager';
import { AppSidebar } from './components/AppSidebar';
import { HubExplorer } from './components/HubExplorer';
import { SearchBar } from './components/SearchBar';
import { Controls } from './components/Controls';
import { ResultsView } from './components/ResultsView';
import { PluginModal } from './components/PluginModal';
import { DocsView } from './components/DocsView';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { ImportPreviewModal, PendingImport } from './components/ImportPreviewModal';
import { ExportSourcesModal } from './components/ExportSourcesModal';
import { pluginHost } from './plugins/host/PluginHost';
import { WorkspaceLeaf } from './plugins/types';
import { pluginRegistry, SectionDefinition } from './plugins/PluginRegistry';
import { LoadedPlugin, MappingConfig, SearchResult, Source, ToastItem } from './types';

const VIEW_MODE_KEY = 'indexly_view_mode';
const SIDEBAR_KEY = 'indexly_sidebar_collapsed';

/** Vistas propias de la app (no son secciones de plugins). */
const CORE_VIEWS = new Set(['__docs__', '__hub__']);


/**
 * Aplicación principal: monta búsqueda, fuentes, plugins y workspace.
 * No se renderiza en la ventana Spotlight, de modo que esa ventana no
 * inicializa el runtime de plugins ni consulta el catálogo.
 */
function MainApp() {
  const [sources, setSources] = useState<Source[]>([]);
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [workspaceLeaves, setWorkspaceLeaves] = useState<WorkspaceLeaf[]>([]);

  // Secciones registradas por plugins (p. ej. ReadLy)
  const [sections, setSections] = useState<SectionDefinition[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const sectionBodyRef = useRef<HTMLDivElement | null>(null);

  // El Hub ya no necesita token: se limpia el que pudiera quedar guardado
  useEffect(() => {
    try {
      localStorage.removeItem('indexly_hub_token');
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  // Estado de búsqueda
  const [query, setQuery] = useState('');
  const [filterLink, setFilterLink] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('relevance');
  // Barra lateral plegada a iconos (se recuerda entre sesiones)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed));
    } catch {
      /* sin almacenamiento */
    }
  }, [sidebarCollapsed]);

  // Por debajo de 900px la barra lateral se pliega sola a iconos
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 900px)").matches : false
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // En estrecho, desplegar la barra la muestra flotando encima del contenido
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  useEffect(() => {
    if (!isNarrow) setSidebarOverlay(false);
  }, [isNarrow]);
  const railMode = isNarrow ? !sidebarOverlay : sidebarCollapsed;
  const isOverlay = isNarrow && sidebarOverlay;

  // La vista elegida (lista / cuadrícula) se recuerda entre sesiones
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* almacenamiento no disponible: se usa la vista por defecto */
    }
  }, [viewMode]);

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
  // Sólo true hasta que llega la primera respuesta (evita parpadeos al teclear)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

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
      if (activeSectionId && CORE_VIEWS.has(activeSectionId)) return;

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
        setHasLoadedOnce(true);
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) {
          return;
        }
        console.error('Error en búsqueda:', err);
        setHasLoadedOnce(true);
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
  // Archivos esperando a pasar por la vista previa de importación
  const [importQueue, setImportQueue] = useState<PendingImport[]>([]);
  const [importQueueTotal, setImportQueueTotal] = useState(0);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const nextImport = () => {
    setImportQueue((q) => {
      const rest = q.slice(1);
      if (rest.length === 0) setImportQueueTotal(0);
      return rest;
    });
  };

  // Lee los archivos: .torrent como bytes (se importan directamente), .gz se
  // descomprime y el resto pasa por la vista previa para elegir los campos.
  const handleImportFiles = async (files: File[]) => {
    const pending: PendingImport[] = [];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith('.torrent')) {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          const created = await invoke<Source[]>('import_torrent', { name: file.name, bytes });
          showToast(`Torrent "${created[0]?.name ?? file.name}" importado`, 'success');
          await loadSources();
          continue;
        }
        if (lower.endsWith('.gz')) {
          if (typeof DecompressionStream === 'undefined') throw new Error('Este sistema no puede descomprimir .gz');
          const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
          const text = await new Response(stream).text();
          pending.push({ name: file.name.replace(/\.gz$/i, ''), content: text });
          continue;
        }
        pending.push({ name: file.name, content: await file.text() });
      } catch (err) {
        showToast(`No se pudo leer "${file.name}": ${err}`, 'error');
      }
    }
    if (pending.length) {
      setImportQueue((q) => [...q, ...pending]);
      setImportQueueTotal((t) => t + pending.length);
    }
  };

  const handleImportFile = async (name: string, content: string, mapping: MappingConfig | null = null): Promise<boolean> => {
    try {
      const newSources = await invoke<Source[]>('import_file', {
        name,
        content,
        mapping,
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
      return true;
    } catch (err: any) {
      showToast(`Error al importar: ${err}`, 'error');
      return false;
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


  // Cargar más
  const handleLoadMore = () => {
    const nextOffset = offset + limit;
    setOffset(nextOffset);
    executeSearch(query, filterLink, sortBy, nextOffset, true);
  };

  // Pestañas de plugins: secciones legacy + vistas del workspace (deduplicadas por viewType)
  const pluginTabs: Array<{ id: string; label: string; onSelect: () => void }> = [
    ...sections.map((sec) => ({
      id: sec.id,
      label: sec.label,
      onSelect: () => setActiveSectionId(sec.id),
    })),
    ...Array.from(
      new Map(workspaceLeaves.filter((l) => l.view).map((l) => [l.view!.getViewType(), l])).values()
    ).map((leaf) => {
      const viewType = leaf.view!.getViewType();
      return {
        id: viewType,
        label: leaf.view!.getDisplayText() || 'Vista',
        onSelect: () => {
          setActiveSectionId(viewType);
          pluginHost.sharedWorkspace.revealLeaf(leaf);
        },
      };
    }),
  ];

  const sectionTitle =
    activeSectionId === '__docs__'
      ? 'Documentación'
      : activeSectionId === '__hub__'
        ? 'Explorar Hub'
        : pluginTabs.find((t) => t.id === activeSectionId)?.label || 'Sección';

  return (
    <div className={`App app-shell ${railMode ? 'is-sidebar-rail' : ''} ${isOverlay ? 'is-sidebar-overlay' : ''}`}>
      <AppSidebar
        collapsed={railMode}
        onToggleCollapsed={() => {
          if (isNarrow) setSidebarOverlay((o) => !o);
          else setSidebarCollapsed((c) => !c);
        }}
        activeId={activeSectionId}
        onSelectCore={(id) => {
          setActiveSectionId(id);
          setSidebarOverlay(false);
        }}
        pluginItems={pluginTabs}
        activeSourcesLabel={`${sources.filter((s) => s.active).length}/${sources.length} activas`}
        pluginsCount={plugins.filter((p) => p.manifest.enabled).length}
        onOpenPlugins={() => setIsPluginModalOpen(true)}
        sources={
          <SourceManager
            variant="sidebar"
            sources={sources}
            plugins={plugins}
            onImportFiles={handleImportFiles}
            onOpenExport={() => setIsExportOpen(true)}
            onToggleSource={handleToggleSource}
            onDeleteSource={handleDeleteSource}
            onTogglePackage={handleTogglePackage}
            onDeletePackage={handleDeletePackage}
            onRefreshSources={loadSources}
            onRefreshPlugins={loadPlugins}
            showToast={showToast}
          />
        }
      />

      {isOverlay && (
        <div className="app-sidebar-scrim" onClick={() => setSidebarOverlay(false)} aria-hidden="true" />
      )}

      <div className="app-main">
        <Header onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}>
          {activeSectionId ? (
            <div className="app-topbar__title">
              <button
                type="button"
                className="app-topbar__back"
                onClick={() => setActiveSectionId(null)}
                aria-label="Volver al buscador"
                title="Volver al buscador (Esc)"
              >
                <ArrowLeft size={15} />
              </button>
              <h1>{sectionTitle}</h1>
            </div>
          ) : (
            <SearchBar query={query} onChange={setQuery} />
          )}
        </Header>

        <main className={`Search app-content ${activeSectionId ? 'section-open' : ''}`}>
          {/* Vista integrada de Documentación */}
          {activeSectionId === '__docs__' && <DocsView onClose={() => setActiveSectionId(null)} />}

          {/* Explorador del Hub, ahora como vista de la zona principal */}
          {activeSectionId === '__hub__' && (
            <div className="app-view app-view--hub">
              <HubExplorer
                onRefreshSources={loadSources}
                onRefreshPlugins={loadPlugins}
                plugins={plugins}
                sources={sources}
                showToast={showToast}
              />
            </div>
          )}

          {/* Contenedor de sección de plugin activa (ReadLy, GameVault…) */}
          <div
            id="plugin-sections"
            className="plugin-sections"
            style={{ display: activeSectionId && !CORE_VIEWS.has(activeSectionId) ? 'block' : 'none' }}
            aria-live="polite"
          >
            <div ref={sectionBodyRef} className="plx-section-body" />
          </div>

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
            isLoading={!hasLoadedOnce}
          />
        </main>

        {/* Barra de estado reactiva unificada (Plugin API v1) */}
        <footer className="indexly-status-bar" id="indexly-status-bar" />
      </div>

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

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type || 'success'}`}>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Paleta de Comandos Interactiva (Ctrl+P / Cmd+P / Ctrl+K) */}
      {/* Vista previa de importación (uno por archivo de la cola) */}
      {importQueue.length > 0 && (
        <ImportPreviewModal
          file={importQueue[0]}
          position={importQueueTotal - importQueue.length + 1}
          total={importQueueTotal}
          onCancel={() => {
            setImportQueue([]);
            setImportQueueTotal(0);
          }}
          onSkip={importQueue.length > 1 ? nextImport : undefined}
          onConfirm={async (name, mapping) => {
            const ok = await handleImportFile(name, importQueue[0].content, mapping);
            if (ok) nextImport();
          }}
        />
      )}

      {isExportOpen && (
        <ExportSourcesModal
          open
          sources={sources}
          onClose={() => setIsExportOpen(false)}
          showToast={showToast}
        />
      )}

      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenDocs={() => setActiveSectionId('__docs__')}
        onOpenPlugins={() => setIsPluginModalOpen(true)}
        onOpenHub={() => setActiveSectionId('__hub__')}
        onFocusSearch={() => setActiveSectionId(null)}
      />
    </div>
  );
}

/**
 * Ventana Spotlight: deliberadamente mínima. No monta `MainApp`; sólo carga
 * las fuentes (para `getIndexes`) y el propio plugin `spotlight`, que es quien
 * pinta la paleta dentro de `#spotlight-window-root`.
 */
function SpotlightWindow() {
  useEffect(() => {
    document.documentElement.classList.add('spotlight-window');
    document.body.classList.add('spotlight-window');

    let cancelled = false;
    (async () => {
      try {
        const [list, sources] = await Promise.all([
          invoke<LoadedPlugin[]>('get_plugins'),
          invoke<Source[]>('get_sources').catch(() => [] as Source[]),
        ]);
        if (cancelled) return;
        pluginRegistry.setSources(sources);
        const spotlight = list.filter((p) => p.manifest.id === 'spotlight' && p.manifest.enabled);
        if (!spotlight.length) {
          console.warn('[Spotlight] El plugin "spotlight" no está instalado o está desactivado.');
          return;
        }
        await pluginRegistry.loadPlugins(spotlight);
      } catch (err) {
        console.error('[Spotlight] No se pudo cargar el plugin en la ventana flotante:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <div id="spotlight-window-root" style={{ width: '100%', height: '100%' }} />;
}

/**
 * Selector de ventana. El montaje de `MainApp` es lo que activa la
 * inicialización de plugins; en Spotlight ese árbol nunca se monta.
 */
export function App() {
  const isSpotlightWindow =
    typeof window !== 'undefined' && window.location.search.includes('window=spotlight');

  return isSpotlightWindow ? <SpotlightWindow /> : <MainApp />;
}

export default App;

