// src/plugins/PluginRegistry.ts — Motor Co-Kernel de extensibilidad omnipotente para IndexLy
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as React from 'react';
import { pluginHost, detectPluginRuntime } from './host/PluginHost';
import { validateAndNormalizeManifest } from './manifest/validator';
import { ui as uiKit, mount as mountUi, unmount as unmountUi } from '../ui';
import {
  UnifiedItem,
  LoadedPlugin,
  Source,
  IndexFlagConfig,
  SourceActionConfig,
  SearchResult,
  CustomViewDefinition,
  DynamicWindowConfig,
  ProcessRunResult,
  FsEntry,
  PluginSettingSchema,
} from '../types';

export interface CardActionDefinition {
  pluginId: string;
  id?: string;
  label: string;
  condition?: (item: UnifiedItem) => boolean;
  onClick: (item: UnifiedItem) => void;
}

export interface ChipDefinition {
  pluginId: string;
  id: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}

export interface SectionDefinition {
  pluginId: string;
  id: string;
  label: string;
  render: (container: HTMLElement) => void;
}

export interface ComponentOverride {
  pluginId: string;
  target: string;
  render: (container: HTMLElement, props: any) => void;
}

export type PipelineStage = 'search:query' | 'search:results' | 'import:file' | 'item:open' | string;
export type PipelineMiddleware<T = any> = (ctx: T, next: () => Promise<void>) => Promise<void> | void;

type Listener = () => void;
type EventHandler = (data: any) => void;

class NativePluginStorage {
  private memoryCache: Map<string, any> = new Map();
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getLegacyIDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          return reject(new Error('IndexedDB no disponible'));
        }
        const req = indexedDB.open('indexly_plugin_storage', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('kv')) {
            req.result.createObjectStore('kv');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private async readLegacy(pluginId: string, key: string): Promise<any> {
    try {
      const db = await this.getLegacyIDB();
      const val = await new Promise<any>((resolve) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(`${pluginId}:${key}`);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : undefined);
        req.onerror = () => resolve(undefined);
      });
      if (val !== undefined) return val;
    } catch {
      // Fallback a localStorage
    }

    if (typeof localStorage !== 'undefined') {
      const legacy = localStorage.getItem(`plx_${pluginId}_${key}`);
      if (legacy !== null) {
        try {
          return JSON.parse(legacy);
        } catch {
          return legacy;
        }
      }
    }
    return undefined;
  }

  async get(pluginId: string, key: string): Promise<any> {
    // 1. Intentar desde SQLite nativo
    try {
      const raw = await invoke<string | null>('plugin_storage_get', { pluginId, key });
      if (raw !== null && raw !== undefined) {
        try {
          const parsed = JSON.parse(raw);
          this.memoryCache.set(`${pluginId}:${key}`, parsed);
          return parsed;
        } catch {
          this.memoryCache.set(`${pluginId}:${key}`, raw);
          return raw;
        }
      }
    } catch (err) {
      // Si estamos en un entorno sin Tauri IPC (tests unitarios web puro)
      if (this.memoryCache.has(`${pluginId}:${key}`)) {
        return this.memoryCache.get(`${pluginId}:${key}`);
      }
    }

    // 2. Si no estaba en SQLite nativo, migrar automáticamente desde IndexedDB / localStorage previo
    const legacyVal = await this.readLegacy(pluginId, key);
    if (legacyVal !== undefined && legacyVal !== null) {
      // Migrar al instante a SQLite nativo para unificar dev y build
      await this.set(pluginId, key, legacyVal);
      return legacyVal;
    }

    return null;
  }

  async set(pluginId: string, key: string, val: any): Promise<void> {
    this.memoryCache.set(`${pluginId}:${key}`, val);
    const serialized = typeof val === 'string' ? val : JSON.stringify(val);

    try {
      await invoke('plugin_storage_set', { pluginId, key, val: serialized });
    } catch (err) {
      // En tests sin Tauri backend, la memoria ya retiene el valor
    }

    // Guardar también copia de seguridad en IDB local para no perder compatibilidad offline
    try {
      const db = await this.getLegacyIDB();
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, `${pluginId}:${key}`);
    } catch {
      // No crítico
    }
  }

  async remove(pluginId: string, key: string): Promise<void> {
    this.memoryCache.delete(`${pluginId}:${key}`);

    try {
      await invoke('plugin_storage_delete', { pluginId, key });
    } catch {
      // Ignorar
    }

    try {
      const db = await this.getLegacyIDB();
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(`${pluginId}:${key}`);
    } catch {
      // Ignorar
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`plx_${pluginId}_${key}`);
    }
  }
}

const idbStorage = new NativePluginStorage();

class PluginRegistry {
  private cardActions: CardActionDefinition[] = [];
  private chips: ChipDefinition[] = [];
  private sections: SectionDefinition[] = [];
  private indexFlags: IndexFlagConfig[] = [];
  private sourceActions: SourceActionConfig[] = [];
  private slotRenderers: Map<string, Array<{ pluginId: string; render: (container: HTMLElement, context: any) => void }>> = new Map();
  private registeredViews: Map<string, CustomViewDefinition & { pluginId?: string }> = new Map();
  private activeViewId: string | null = null;
  private componentOverrides: Map<string, ComponentOverride> = new Map();
  private pipelineMiddlewares: Map<string, Array<PipelineMiddleware>> = new Map();
  private pluginDisposables: Map<string, Array<() => void>> = new Map();
  private dynamicShortcuts: Map<string, Array<{ pluginId: string; callback: () => void }>> = new Map();
  private pluginSettingsSchemas: Map<string, PluginSettingSchema[]> = new Map();
  private pluginCustomSettingsRenderers: Map<string, (container: HTMLElement) => void> = new Map();

  private sources: Source[] = [];
  private listeners: Set<Listener> = new Set();
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private toastHandler: ((msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void) | null = null;
  private currentQuery: string = '';

  constructor() {
    // El host es el único runtime. Este registro aporta el adaptador legacy
    // (window.IndexLy) sin mantener un segundo conjunto de instancias activas.
    pluginHost.registerRuntimeAdapter({
      kind: 'legacy',
      load: (manifest, code) => this.loadLegacyBundle(manifest.id, code),
    });

    try {
      listen('global-shortcut:pressed', (event: any) => {
        const scStr = String(event.payload || '').toLowerCase();
        this.emit('global-shortcut:pressed', { shortcut: scStr });
        this.dynamicShortcuts.forEach((handlers, registeredSc) => {
          if (scStr.includes(registeredSc.toLowerCase())) {
            handlers.forEach((h) => {
              try {
                h.callback();
              } catch (e) {
                console.error('[Plugin Shortcut Error]', e);
              }
            });
          }
        });
      });

      listen('spotlight:toggle', () => {
        this.emit('spotlight:toggle', {});
      });
      listen('spotlight:open', () => {
        this.emit('spotlight:open', {});
        this.emit('spotlight:toggle', {});
      });
    } catch (e) {
      console.warn('Could not listen for tauri events', e);
    }
  }

  public registerDisposable(pluginId: string, fn: () => void) {
    if (!this.pluginDisposables.has(pluginId)) {
      this.pluginDisposables.set(pluginId, []);
    }
    this.pluginDisposables.get(pluginId)!.push(fn);
  }

  public setSources(s: Source[]) {
    this.sources = s;
  }

  public setQuery(q: string) {
    this.currentQuery = q;
    this.emit('query:change', { query: q });
  }

  public setToastHandler(fn: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void) {
    this.toastHandler = fn;
  }

  public showToast(msg: string, type?: 'success' | 'warning' | 'error' | 'info') {
    if (this.toastHandler) {
      this.toastHandler(msg, type);
    } else {
      console.log(`[Toast] ${type || 'info'}: ${msg}`);
    }
  }

  public on(event: string, fn: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(fn);
    return () => {
      this.eventHandlers.get(event)?.delete(fn);
    };
  }

  public emit(event: string, data?: any) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(data);
        } catch (err) {
          console.error(`[Plugin Event] Error en evento "${event}":`, err);
        }
      });
    }
  }

  // --- Pipeline Engine ---
  public async runPipeline<T>(stage: string, context: T, fallback?: (ctx: T) => Promise<T> | T): Promise<T> {
    const middlewares = this.pipelineMiddlewares.get(stage) || [];
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        await mw(context, next);
      } else if (fallback) {
        await fallback(context);
      }
    };

    if (middlewares.length > 0) {
      await next();
    } else if (fallback) {
      await fallback(context);
    }
    return context;
  }

  // --- Registros con deduplicación por plugin y clave ---
  public registerCardAction(action: CardActionDefinition) {
    const idx = this.cardActions.findIndex(
      (a) => a.pluginId === action.pluginId && ((action.id && a.id === action.id) || a.label === action.label)
    );
    if (idx >= 0) {
      this.cardActions[idx] = action;
    } else {
      this.cardActions.push(action);
    }
    this.notify();
  }

  public registerChip(chip: ChipDefinition) {
    const idx = this.chips.findIndex(
      (c) => (chip.pluginId ? c.pluginId === chip.pluginId && c.id === chip.id : c.id === chip.id)
    );
    if (idx >= 0) {
      this.chips[idx] = chip;
    } else {
      this.chips.push(chip);
    }
    this.notify();
  }

  public registerSection(sec: SectionDefinition) {
    const idx = this.sections.findIndex((s) => s.id === sec.id);
    if (idx >= 0) {
      this.sections[idx] = sec;
    } else {
      this.sections.push(sec);
    }
    this.notify();
    this.emit('state:change', { type: 'section:registered', section: sec });
    this.emit('sections:changed', this.getSections());
  }

  public registerIndexFlag(flag: IndexFlagConfig) {
    const idx = this.indexFlags.findIndex((f) => f.id === flag.id);
    if (idx >= 0) {
      this.indexFlags[idx] = flag;
    } else {
      this.indexFlags.push(flag);
    }
    this.notify();
  }

  public registerSourceAction(action: SourceActionConfig) {
    const idx = this.sourceActions.findIndex(
      (a) => a.pluginId === action.pluginId && a.id === action.id
    );
    if (idx >= 0) {
      this.sourceActions[idx] = action;
    } else {
      this.sourceActions.push(action);
    }
    this.notify();
  }

  public registerSlotRenderer(slotName: string, renderer: { pluginId: string; render: (container: HTMLElement, context: any) => void }) {
    if (!this.slotRenderers.has(slotName)) {
      this.slotRenderers.set(slotName, []);
    }
    const list = this.slotRenderers.get(slotName)!;
    const idx = list.findIndex((r) => r.pluginId === renderer.pluginId);
    if (idx >= 0) {
      list[idx] = renderer;
    } else {
      list.push(renderer);
    }
    this.notify();
  }

  public registerView(viewDef: CustomViewDefinition, pluginId?: string) {
    this.registeredViews.set(viewDef.id, { ...viewDef, pluginId });
    this.notify();
  }

  public getRegisteredViews(): CustomViewDefinition[] {
    return Array.from(this.registeredViews.values());
  }

  public getActiveView(): CustomViewDefinition | null {
    if (!this.activeViewId) return null;
    return this.registeredViews.get(this.activeViewId) || null;
  }

  public setActiveView(id: string | null) {
    this.activeViewId = id;
    this.notify();
  }

  public overrideComponent(target: string, render: (container: HTMLElement, props: any) => void, pluginId: string) {
    this.componentOverrides.set(target, { pluginId, target, render });
    this.notify();
  }

  public getComponentOverride(target: string): ComponentOverride | null {
    return this.componentOverrides.get(target) || null;
  }

  // --- Sistema de Ajustes de Plugins ---
  public registerPluginSettingsSchema(pluginId: string, schema: PluginSettingSchema[]) {
    this.pluginSettingsSchemas.set(pluginId, schema);
    this.notify();
  }

  public getPluginSettingsSchema(pluginId: string): PluginSettingSchema[] {
    return this.pluginSettingsSchemas.get(pluginId) || [];
  }

  public registerCustomSettingsRenderer(pluginId: string, render: (container: HTMLElement) => void) {
    this.pluginCustomSettingsRenderers.set(pluginId, render);
    this.notify();
  }

  public getCustomSettingsRenderer(pluginId: string): ((container: HTMLElement) => void) | null {
    return this.pluginCustomSettingsRenderers.get(pluginId) || null;
  }

  public async getPluginSetting(pluginId: string, key: string, defaultValue?: any): Promise<any> {
    const val = await idbStorage.get(pluginId, `setting_${key}`);
    return val !== null && val !== undefined ? val : defaultValue;
  }

  public async setPluginSetting(pluginId: string, key: string, value: any): Promise<void> {
    await idbStorage.set(pluginId, `setting_${key}`, value);
    this.emit('settings:change', { pluginId, key, value });
    this.emit(`settings:${pluginId}:change`, { key, value });
    this.notify();
  }

  public getCardActions(): CardActionDefinition[] {
    return [...this.cardActions];
  }

  public getChips(): ChipDefinition[] {
    return [...this.chips];
  }

  public getSections(): SectionDefinition[] {
    return [...this.sections];
  }

  public getIndexFlags(): IndexFlagConfig[] {
    return [...this.indexFlags];
  }

  public getSourceActions(): SourceActionConfig[] {
    return [...this.sourceActions];
  }

  public getSlotRenderers(slotName: string): Array<{ pluginId: string; render: (container: HTMLElement, context: any) => void }> {
    return this.slotRenderers.get(slotName) || [];
  }

  public getIndexFlag(sourceId: string, flagId: string): boolean {
    const s = this.sources.find((item) => item.id === sourceId);
    if (!s || !s.flags) return false;
    return !!s.flags[flagId];
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.error('[PluginRegistry] Error en listener:', err);
      }
    });
  }

  public clear() {
    this.cardActions = [];
    this.chips = [];
    this.sections = [];
    this.indexFlags = [];
    this.sourceActions = [];
    this.slotRenderers.clear();
    this.registeredViews.clear();
    this.activeViewId = null;
    this.componentOverrides.clear();
    this.pipelineMiddlewares.clear();
    this.pluginDisposables.clear();
    this.dynamicShortcuts.clear();
    this.notify();
  }

  /**
   * Limpia los registros de UI asociados a un plugin.
   *
   * No orquesta el ciclo de vida: `PluginHost.disablePlugin()` es quien ejecuta
   * `onunload`, purga eventos y libera la instancia. Este método solo retira
   * los elementos visuales/compatibilidad del plugin.
   */
  public teardownPlugin(pluginId: string) {
    // 1. Ejecutar limpiadores y disposables del plugin
    const disposables = this.pluginDisposables.get(pluginId);
    if (disposables) {
      disposables.forEach((d) => {
        try {
          d();
        } catch (err) {
          console.error(`[PluginRegistry] Error en disposable de ${pluginId}:`, err);
        }
      });
      this.pluginDisposables.delete(pluginId);
    }

    // 2. Limpiar elementos registrados
    this.cardActions = this.cardActions.filter((a) => a.pluginId !== pluginId);
    this.chips = this.chips.filter((c) => c.pluginId !== pluginId);
    const hadSections = this.sections.some((s) => s.pluginId === pluginId);
    this.sections = this.sections.filter((s) => s.pluginId !== pluginId);
    if (hadSections) {
      this.emit('state:change', { type: 'section:removed', pluginId });
      this.emit('sections:changed', this.getSections());
    }
    this.indexFlags = this.indexFlags.filter((f) => f.pluginId !== pluginId);
    this.sourceActions = this.sourceActions.filter((a) => a.pluginId !== pluginId);
    this.slotRenderers.forEach((renderers, slotName) => {
      this.slotRenderers.set(slotName, renderers.filter((r) => r.pluginId !== pluginId));
    });

    // 3. Vistas y Overrides
    for (const [vId, vDef] of this.registeredViews.entries()) {
      if (vDef.pluginId === pluginId) {
        this.registeredViews.delete(vId);
        if (this.activeViewId === vId) {
          this.activeViewId = null;
        }
      }
    }
    for (const [target, override] of this.componentOverrides.entries()) {
      if (override.pluginId === pluginId) {
        this.componentOverrides.delete(target);
      }
    }

    // 4. Atajos dinámicos
    this.dynamicShortcuts.forEach((handlers, sc) => {
      const remaining = handlers.filter((h) => h.pluginId !== pluginId);
      if (remaining.length === 0) {
        invoke('native_unregister_shortcut', { shortcut: sc }).catch(() => {});
        this.dynamicShortcuts.delete(sc);
      } else {
        this.dynamicShortcuts.set(sc, remaining);
      }
    });

    // 5. Middlewares de Pipeline
    this.pipelineMiddlewares.forEach((mws, stage) => {
      this.pipelineMiddlewares.set(stage, mws.filter((m: any) => m.__pluginId !== pluginId));
    });

    // 6. Eliminar estilos
    const styleTag = document.querySelector(`style[data-plugin="${pluginId}"]`);
    if (styleTag) styleTag.remove();

    // Limpiezas legacy para plugins v1
    if (pluginId === 'vistas') {
      const plxvStyles = document.getElementById('plxv-styles');
      if (plxvStyles) plxvStyles.remove();

      const plxvSeg = document.getElementById('plxv-seg');
      if (plxvSeg) plxvSeg.remove();

      const results = document.getElementById('results');
      if (results) {
        results.classList.remove('plxv-dense', 'plxv-table', 'plxv-posters');
        results.querySelectorAll('[data-plxv-h]').forEach((el) => {
          el.removeAttribute('data-plxv-h');
        });
      }
    }

    if (pluginId === 'readly') {
      const libStyles = document.getElementById('lib-styles');
      if (libStyles) libStyles.remove();
    }

    this.notify();
  }

  public openModal(opts: any) {
    const modalEl = document.getElementById('plugin-modal');
    const titleEl = document.getElementById('plugin-modal-title');
    const bodyEl = document.getElementById('plugin-modal-body');
    const actionsEl = document.getElementById('plugin-modal-actions');
    if (!modalEl || !titleEl || !bodyEl || !actionsEl) return;

    titleEl.textContent = opts.title || 'Plugin';

    const content = opts.html !== undefined ? opts.html : (opts.body !== undefined ? opts.body : '');
    if (typeof content === 'function') {
      bodyEl.innerHTML = '';
      content(bodyEl);
    } else {
      bodyEl.innerHTML = String(content);
    }

    actionsEl.innerHTML = '';
    if (Array.isArray(opts.actions)) {
      opts.actions.forEach((act: any) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `action-btn ${act.danger ? 'danger' : act.primary ? 'primary' : (act.variant || 'secondary')}`;
        btn.textContent = act.label;
        btn.onclick = async () => {
          let keep = false;
          if (act.onClick) {
            try {
              keep = (await act.onClick(bodyEl, btn)) === false;
            } catch (err) {
              console.error('[IndexLy Modal Action Error]:', err);
            }
          }
          if (!keep && act.close !== false) {
            (window as any).closePluginModal && (window as any).closePluginModal();
          }
        };
        actionsEl.appendChild(btn);
      });
    }

    modalEl.style.display = 'flex';
    modalEl.setAttribute('aria-hidden', 'false');
    modalEl.classList.add('open');
  }

  /**
   * Construye la fachada de API legacy (`IndexLy`) para un plugin concreto.
   *
   * Esta fachada solo se usa desde el adaptador legacy registrado en `PluginHost`.
   * La ejecución y el ciclo de vida siguen perteneciendo al host.
   */
  private createLegacyApi(pluginId: string) {
    const self = this;
    return {
      apiVersion: 3,
      info: { id: pluginId, name: pluginId, version: '1.0.0' },

      // 1. Acceso a datos
      getIndexes: () => {
        return self.sources.map((s) => ({
          id: s.id,
          name: s.name,
          active: s.active,
          count: s.count,
          pkg: s.pkg,
          mapping: s.mapping,
          flags: s.flags || {},
          getItems: () => invoke<UnifiedItem[]>('get_source_items', { id: s.id }),
        }));
      },
      addSource: async (input: any) => {
        if (!input) throw new Error('addSource requiere un objeto de entrada');
        const name = input.name || 'Nueva fuente';
        let content = '';
        if (typeof input.rawData === 'string') {
          content = input.rawData;
        } else if (input.rawData) {
          content = JSON.stringify(input.rawData);
        } else if (input.content) {
          content = input.content;
        } else {
          content = JSON.stringify([]);
        }
        const mapping = input.mapping || {
          titleKey: 'title',
          subtitleKey: 'subtitle',
          linkKey: 'link',
        };
        const res = await invoke<Source[]>('import_file', { name, content, mapping });
        self.emit('sources:changed', {});
        return res;
      },
      refreshApp: () => {
        // Los plugins llaman a refreshApp() tras cambiar datos locales (p. ej. la
        // vault de GameVault). Además de recargar fuentes, hay que re-renderizar
        // los slots para que la UI refleje el cambio al instante.
        self.emit('sources:changed', {});
        self.notify();
      },
      getItemsBySource: async (sourceId: string): Promise<UnifiedItem[]> => {
        try {
          return await invoke<UnifiedItem[]>('get_source_items', { id: sourceId });
        } catch {
          return [];
        }
      },
      getAllGames: async (): Promise<UnifiedItem[]> => {
        try {
          const res = await invoke<SearchResult>('search_items', {
            query: '',
            filterLink: null,
            sortBy: 'relevance',
            limit: 500,
            offset: 0,
          });
          return res.items || [];
        } catch {
          return [];
        }
      },
      getFilteredGames: () => [],
      getQuery: () => self.currentQuery,
      search: async (
        q: string,
        opts?: { limit?: number; offset?: number; filterLink?: string | null; sortBy?: string }
      ): Promise<SearchResult> => {
        try {
          self.currentQuery = q || '';
          const queryCtx = await self.runPipeline('search:query', {
            query: q || '',
            filterLink: opts?.filterLink || null,
            sortBy: opts?.sortBy || 'relevance',
            limit: opts?.limit ?? 30,
            offset: opts?.offset ?? 0,
          });

          let res = await invoke<SearchResult>('search_items', {
            query: queryCtx.query,
            filterLink: queryCtx.filterLink,
            sortBy: queryCtx.sortBy,
            limit: queryCtx.limit,
            offset: queryCtx.offset,
          });

          const pipelineRes = await self.runPipeline('search:results', {
            ...res,
            query: queryCtx.query,
          });

          return pipelineRes;
        } catch (err) {
          console.error('[IndexLy API] Error en api.search:', err);
          return { items: [], total: 0, active_sources_count: 0, total_items_count: 0, took_ms: 0 };
        }
      },
      copyToClipboard: async (text: string): Promise<boolean> => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          try {
            const t = document.createElement('textarea');
            t.value = text;
            t.style.position = 'fixed';
            t.style.opacity = '0';
            document.body.appendChild(t);
            t.select();
            document.execCommand('copy');
            t.remove();
            return true;
          } catch {
            return false;
          }
        }
      },
      getCardActions: (item: UnifiedItem) => {
        return self.cardActions.filter((a) => !a.condition || a.condition(item));
      },
      hideWindow: async () => {
        try {
          await invoke('hide_window');
        } catch (err) {
          console.error('[IndexLy API] Error en hideWindow:', err);
        }
      },

      // 2. Extensibilidad de UI básica (Slots y Secciones)
      addIndexFlag: (opts: any) => {
        if (!opts || !opts.id || typeof opts.label !== 'string') return;
        self.registerIndexFlag({
          pluginId,
          id: String(opts.id),
          label: String(opts.label),
          hint: opts.hint,
          defaultValue: !!opts.defaultValue,
        });
      },
      addSourceAction: (opts: any) => {
        if (!opts || !opts.id || typeof opts.label !== 'string' || typeof opts.onClick !== 'function') return;
        self.registerSourceAction({
          pluginId,
          id: String(opts.id),
          label: String(opts.label),
          short: opts.short || null,
          match: opts.match || null,
          onClick: opts.onClick,
        });
      },
      getIndexFlag: (sourceId: string, flagId: string) => {
        return self.getIndexFlag(sourceId, flagId);
      },
      addSlotRenderer: (slotName: string, render: (container: HTMLElement, context: any) => void) => {
        if (!slotName || typeof render !== 'function') return;
        self.registerSlotRenderer(slotName, { pluginId, render });
      },
      addCardAction: (opts: { id?: string; label: string; condition?: (item: UnifiedItem) => boolean; match?: (item: UnifiedItem) => boolean; onClick: (item: UnifiedItem) => void }) => {
        if (!opts || typeof opts.label !== 'string' || typeof opts.onClick !== 'function') return;
        self.registerCardAction({
          pluginId,
          id: opts.id,
          label: opts.label,
          condition: opts.condition || opts.match,
          onClick: opts.onClick,
        });
      },
      addChip: (opts: { id: string; label: string; onClick: () => void; active?: boolean }) => {
        if (!opts || !opts.id || typeof opts.label !== 'string') return;
        self.registerChip({
          pluginId,
          id: opts.id,
          label: opts.label,
          onClick: opts.onClick,
          active: opts.active,
        });
      },
      addSection: (opts: { id: string; label: string; render: (container: HTMLElement) => void }) => {
        if (!opts || !opts.id || typeof opts.label !== 'string' || typeof opts.render !== 'function') return;
        self.registerSection({
          pluginId,
          id: opts.id,
          label: opts.label,
          render: opts.render,
        });
      },
      getSections: () => self.getSections(),
      addDocSection: () => {},
      showToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => {
        self.showToast(msg, type);
      },
      modal: (opts: any) => {
        self.openModal(opts);
      },
      openLink: async (url: string) => {
        if (!url) return;
        try {
          if (
            url.startsWith('http://') ||
            url.startsWith('https://') ||
            url.startsWith('magnet:') ||
            url.startsWith('file:///') ||
            url.includes(':\\')
          ) {
            await invoke('open_external_url', { url });
          } else {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        } catch {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      },
      debounce: (fn: Function, delay: number = 100) => {
        let t: any;
        return (...args: any[]) => {
          clearTimeout(t);
          t = setTimeout(() => fn(...args), delay);
        };
      },
      escapeHtml: (str: string) => {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      },
      on: (event: string, fn: EventHandler) => {
        return self.on(event, fn);
      },
      emit: (event: string, data?: any) => {
        self.emit(event, data);
      },
      storage: {
        get: (key: string) => idbStorage.get(pluginId, key),
        set: (key: string, val: any) => idbStorage.set(pluginId, key, val),
        remove: (key: string) => idbStorage.remove(pluginId, key),
      },

      // ========================================================
      // 3. CO-KERNEL EXPANSION: SUPERPODERES
      // ========================================================

      // Pipeline de interceptores / middleware
      pipeline: {
        intercept: (stage: string, middleware: PipelineMiddleware) => {
          (middleware as any).__pluginId = pluginId;
          if (!self.pipelineMiddlewares.has(stage)) {
            self.pipelineMiddlewares.set(stage, []);
          }
          self.pipelineMiddlewares.get(stage)!.push(middleware);
          const unreg = () => {
            const list = self.pipelineMiddlewares.get(stage) || [];
            self.pipelineMiddlewares.set(
              stage,
              list.filter((m) => m !== middleware)
            );
          };
          self.registerDisposable(pluginId, unreg);
          return unreg;
        },
      },

      // Sistema de vistas completas y reemplazo de componentes UI
      ui: {
        registerView: (viewDef: CustomViewDefinition) => {
          self.registerView(viewDef, pluginId);
          const unreg = () => {
            if (self.registeredViews.get(viewDef.id)?.pluginId === pluginId) {
              self.registeredViews.delete(viewDef.id);
              if (self.activeViewId === viewDef.id) self.activeViewId = null;
              self.notify();
            }
          };
          self.registerDisposable(pluginId, unreg);
          return unreg;
        },
        override: (target: string, render: (container: HTMLElement, props: any) => void) => {
          self.overrideComponent(target, render, pluginId);
          const unreg = () => {
            if (self.componentOverrides.get(target)?.pluginId === pluginId) {
              self.componentOverrides.delete(target);
              self.notify();
            }
          };
          self.registerDisposable(pluginId, unreg);
          return unreg;
        },
        getActiveView: () => self.getActiveView(),
        setActiveView: (id: string | null) => self.setActiveView(id),
        getRegisteredViews: () => self.getRegisteredViews(),
        components: uiKit,
        mount: mountUi,
        unmount: unmountUi,
        React,
      },

      // OS Bridge nativo de Tauri v2
      native: {
        spawn: async (command: string, args: string[] = [], cwd?: string): Promise<ProcessRunResult> => {
          return await invoke<ProcessRunResult>('native_spawn_process', { command, args, cwd });
        },
        windows: {
          create: async (config: DynamicWindowConfig): Promise<void> => {
            await invoke('native_create_window', { config });
          },
          show: async (label: string): Promise<void> => {
            await invoke('native_show_window', { label });
          },
          hide: async (label: string): Promise<void> => {
            await invoke('native_hide_window', { label });
          },
          close: async (label: string): Promise<void> => {
            await invoke('native_close_window', { label });
          },
          toggle: async (label: string): Promise<boolean> => {
            return await invoke<boolean>('native_toggle_window', { label });
          },
        },
        fs: {
          readDir: async (path: string, recursive?: boolean): Promise<FsEntry[]> => {
            return await invoke<FsEntry[]>('native_fs_read_dir', { path, recursive });
          },
          readFile: async (path: string): Promise<string> => {
            return await invoke<string>('native_fs_read_file', { path });
          },
          writeFile: async (path: string, content: string): Promise<void> => {
            await invoke('native_fs_write_file', { path, content });
          },
          exists: async (path: string): Promise<boolean> => {
            return await invoke<boolean>('native_fs_exists', { path });
          },
        },
        db: {
          execute: async (query: string): Promise<number> => {
            return await invoke<number>('native_sql_execute', { query });
          },
          query: async (query: string): Promise<any[]> => {
            return await invoke<any[]>('native_sql_query', { query });
          },
        },
        keychain: {
          get: async (key: string): Promise<string | null> => {
            try {
              return await invoke<string | null>('plugin_keychain_get', { key });
            } catch {
              return null;
            }
          },
          set: async (key: string, value: string): Promise<void> => {
            await invoke('plugin_keychain_set', { key, val: value });
          },
          delete: async (key: string): Promise<void> => {
            await invoke('plugin_keychain_delete', { key });
          },
        },
        http: {
          request: async (options: {
            method?: string;
            url: string;
            headers?: Record<string, string>;
            body?: string;
            timeoutMs?: number;
          }): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
            return await invoke('plugin_http_request', {
              method: options.method || 'GET',
              url: options.url,
              headers: options.headers,
              body: options.body,
              timeoutMs: options.timeoutMs,
            });
          },
        },
        shortcuts: {
          register: (shortcut: string, callback: () => void): (() => void) => {
            const scLower = shortcut.toLowerCase();
            if (!self.dynamicShortcuts.has(scLower)) {
              self.dynamicShortcuts.set(scLower, []);
              invoke('native_register_shortcut', { shortcut }).catch((err) => {
                console.error(`Error registrando atajo '${shortcut}':`, err);
              });
            }
            self.dynamicShortcuts.get(scLower)!.push({ pluginId, callback });
            const unreg = () => {
              const list = self.dynamicShortcuts.get(scLower) || [];
              const remaining = list.filter((h) => h.callback !== callback);
              if (remaining.length === 0) {
                self.dynamicShortcuts.delete(scLower);
                invoke('native_unregister_shortcut', { shortcut }).catch(() => {});
              } else {
                self.dynamicShortcuts.set(scLower, remaining);
              }
            };
            self.registerDisposable(pluginId, unreg);
            return unreg;
          },
        },
      },

      // Gestión de fuentes de datos nativas
      sources: {
        list: async (): Promise<Source[]> => {
          try {
            return await invoke<Source[]>('get_sources');
          } catch {
            return self.sources;
          }
        },
        get: (id: string) => self.sources.find((s) => s.id === id) || null,
        getItems: async (id: string): Promise<UnifiedItem[]> => {
          try {
            return await invoke<UnifiedItem[]>('get_source_items', { id });
          } catch {
            return [];
          }
        },
        toggle: async (id: string, active: boolean): Promise<void> => {
          await invoke('toggle_source', { id, active });
          self.emit('source:toggled', { id, active });
        },
        delete: async (id: string): Promise<void> => {
          await invoke('delete_source', { id });
          self.emit('source:deleted', { id });
        },
        importFile: async (name: string, content: string, mapping?: any): Promise<Source[]> => {
          const res = await invoke<Source[]>('import_file', { name, content, mapping });
          self.emit('sources:changed', {});
          return res;
        },
        updateMapping: async (id: string, name: string, mapping: any, flags?: any): Promise<Source> => {
          const res = await invoke<Source>('update_source_mapping', { id, name, mapping, flags });
          self.emit('sources:changed', {});
          return res;
        },
        getMappingInfo: async (id: string): Promise<any> => {
          return await invoke('get_source_mapping_info', { id });
        },
        update: (id: string, patch: any) => {
          self.emit('source:updated', { id, patch });
        },
        remove: async (id: string) => {
          try {
            await invoke('delete_source', { id });
            self.emit('source:deleted', { id });
            self.emit('sources:changed', {});
          } catch (err) {
            console.error('[IndexLy API] Error en sources.remove:', err);
          }
        },
        add: async (input: any) => {
          return await (this.createLegacyApi(pluginId) as any).addSource(input);
        },
        /**
         * Crea o actualiza una fuente gestionada por el plugin y reemplaza sus
         * items en una sola transacción. Es la vía para mantener una fuente
         * única (p. ej. "🧲 Torrents") sin ensuciar el gestor de fuentes.
         */
        syncItems: async (input: {
          sourceId?: string;
          name: string;
          items: UnifiedItem[];
          flags?: Record<string, boolean>;
        }): Promise<Source> => {
          const res = await invoke<Source>('plugin_source_sync_items', {
            sourceId: input.sourceId,
            name: input.name,
            items: input.items,
            flags: input.flags,
          });
          self.emit('sources:changed', {});
          return res;
        },
      },

      // 4. Ajustes y configuración del plugin
      settings: {
        get: async (key: string, defaultValue?: any) => {
          return await self.getPluginSetting(pluginId, key, defaultValue);
        },
        set: async (key: string, value: any) => {
          await self.setPluginSetting(pluginId, key, value);
        },
        onChange: (keyOrFn: string | ((data: any) => void), fn?: (val: any) => void) => {
          if (typeof keyOrFn === 'function') {
            return self.on(`settings:${pluginId}:change`, keyOrFn);
          } else {
            return self.on(`settings:${pluginId}:change`, (data) => {
              if (data.key === keyOrFn && fn) fn(data.value);
            });
          }
        },
        registerSchema: (schema: PluginSettingSchema[]) => {
          self.registerPluginSettingsSchema(pluginId, schema);
        },
        registerPage: (render: (container: HTMLElement) => void) => {
          self.registerCustomSettingsRenderer(pluginId, render);
        },
      },

      // 5. Motor AdBlock nativo (Brave adblock-rust)
      adblock: {
        checkUrl: async (url: string, sourceUrl?: string): Promise<boolean> => {
          try {
            return await invoke<boolean>('adblock_check_url', { url, sourceUrl });
          } catch {
            return false;
          }
        },
        getInfo: async (): Promise<any> => {
          try {
            return await invoke('adblock_get_info');
          } catch {
            return null;
          }
        },
        extractDirectStream: async (
          url: string
        ): Promise<{ original_url: string; direct_url?: string; is_direct: boolean; title?: string }> => {
          try {
            return await invoke('extract_direct_stream', { url });
          } catch {
            return { original_url: url, is_direct: false };
          }
        },
      },

      // Registro de limpieza automática
      disposable: (fn: () => void) => {
        self.registerDisposable(pluginId, fn);
      },
    };
  }

  /**
   * Ejecuta un bundle legacy (`IndexLy.register` / `IndexLy.plugin`) dentro del
   * ciclo de vida del host. El host decide cuándo se carga y se descarga.
   */
  private loadLegacyBundle(pluginId: string, code: string): { unload: () => Promise<void> } {
    const api = this.createLegacyApi(pluginId);
    const legacyGlobal = {
      apiVersion: 3,
      getSections: () => this.getSections(),
      ui: api.ui,
      React,
      register: (def: any) => {
        if (typeof def?.setup === 'function') {
          try {
            def.setup(api);
          } catch (err) {
            console.error(`[IndexLy] Error ejecutando setup de plugin ${pluginId}:`, err);
          }
        }
      },
      plugin: (def: any) => {
        if (typeof def?.activate === 'function') {
          try {
            def.activate(api);
          } catch (err) {
            console.error(`[IndexLy] Error en activate de plugin ${pluginId}:`, err);
          }
        } else if (typeof def?.setup === 'function') {
          try {
            def.setup(api);
          } catch (err) {
            console.error(`[IndexLy] Error en setup de plugin ${pluginId}:`, err);
          }
        }
        if (typeof def?.deactivate === 'function') {
          this.registerDisposable(pluginId, () => def.deactivate());
        }
      },
    };

    if (typeof window !== 'undefined') {
      (window as any).React = (window as any).React || React;
      (window as any).IndexLy = legacyGlobal;
      (window as any).__indexly_get_sections = () => this.getSections();
      (window as any).pluginRuntime = (window as any).pluginRuntime || {};
      (window as any).pluginRuntime.sections = this.sections;
      (window as any).__pluginHost = pluginHost;
    }

    // Ejecución síncrona: los errores se propagan al host, que marca el fallo.
    const runFn = new Function('IndexLy', code);
    runFn(legacyGlobal);

    return {
      unload: async () => {
        this.teardownPlugin(pluginId);
      },
    };
  }

  /**
   * Sincroniza el catálogo del backend con el host.
   *
   * - Registra/actualiza manifiestos normalizados.
   * - Activa solo los plugins habilitados.
   * - Desactiva los que dejaron de estarlo.
   */
  public async loadPlugins(plugins: LoadedPlugin[]): Promise<void> {
    const enabledIds = new Set(plugins.filter((p) => p.manifest.enabled).map((p) => p.manifest.id));

    for (const p of plugins) {
      if (p.manifest.settings && Array.isArray(p.manifest.settings)) {
        this.registerPluginSettingsSchema(p.manifest.id, p.manifest.settings);
      }

      if (!p.manifest.enabled) {
        await pluginHost.disablePlugin(p.manifest.id);
        this.teardownPlugin(p.manifest.id);
        continue;
      }

      if (!p.js_bundle) {
        console.warn(`[PluginRegistry] El plugin '${p.manifest.id}' no tiene bundle ejecutable`);
        continue;
      }

      // Detección explícita por manifiesto, no por búsqueda de cadenas en el bundle.
      const runtime = detectPluginRuntime(p.manifest);

      try {
        const normalizedManifest = validateAndNormalizeManifest(p.manifest);
        const styles = p.css_bundle ?? undefined;
        const wasLoaded = pluginHost.isPluginLoaded(p.manifest.id);
        const bundleChanged = pluginHost.hasBundleChanged(p.manifest.id, p.js_bundle, styles);

        pluginHost.registerPlugin(normalizedManifest, p.js_bundle, styles, {
          runtime,
          origin: 'registry:loadPlugins',
        });

        // Si el plugin estaba activo y su código cambió (actualización), hay que
        // descargar la instancia vieja y cargar la nueva. `enablePlugin()` por sí
        // solo devolvería `true` sin recargar.
        if (wasLoaded && bundleChanged) {
          await pluginHost.reloadPlugin(p.manifest.id);
        } else {
          await pluginHost.enablePlugin(p.manifest.id);
        }
      } catch (pluginErr) {
        console.error(`[PluginHost] Error cargando plugin ${runtime} ${p.manifest.id}:`, pluginErr);
      }
    }

    // Desactivar plugins que siguen cargados pero ya no están habilitados.
    for (const info of pluginHost.getLoadedPlugins()) {
      if (!enabledIds.has(info.manifest.id) && info.isLoaded) {
        await pluginHost.disablePlugin(info.manifest.id);
        this.teardownPlugin(info.manifest.id);
      }
    }

    this.emit('state:change', {});
  }
}

export const pluginRegistry = new PluginRegistry();
