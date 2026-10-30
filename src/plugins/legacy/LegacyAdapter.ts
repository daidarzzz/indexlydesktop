/**
 * @file src/plugins/legacy/LegacyAdapter.ts
 * @description Adaptador retrocompatible de alto nivel que emula el Co-Kernel v3 sobre la nueva arquitectura v1.
 */

import { CustomViewDefinition, IndexFlagConfig, LoadedPlugin, PluginSettingSchema, Source, SourceActionConfig } from '../../types';
import { App } from '../types';
import { CardActionDefinition, ChipDefinition, ComponentOverride, PipelineMiddleware, SectionDefinition } from '../PluginRegistry';

let hasWarnedLegacyRegister = false;
let hasWarnedLegacyPlugin = false;

/**
 * Clase adaptadora que implementa el contrato Co-Kernel v3 previo,
 * delegando en el nuevo PluginHost y los módulos de la API v1.
 */
export class LegacyCoKernelAdapter {
  private _app: App;
  private _cardActions: CardActionDefinition[] = [];
  private _chips: ChipDefinition[] = [];
  private _sections: SectionDefinition[] = [];
  private _indexFlags: IndexFlagConfig[] = [];
  private _sourceActions: SourceActionConfig[] = [];
  private _slotRenderers: Map<string, Array<{ pluginId: string; render: (container: HTMLElement, context: any) => void }>> = new Map();
  private _registeredViews: Map<string, CustomViewDefinition & { pluginId?: string }> = new Map();
  private _activeViewId: string | null = null;
  private _componentOverrides: Map<string, ComponentOverride> = new Map();
  private _pipelineMiddlewares: Map<string, Array<PipelineMiddleware>> = new Map();
  private _settingsSchemas: Map<string, PluginSettingSchema[]> = new Map();
  private _customSettingsRenderers: Map<string, (container: HTMLElement) => void> = new Map();
  private _listeners: Set<() => void> = new Set();
  private _toastHandler: ((msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void) | null = null;
  private _sources: Source[] = [];
  private _currentQuery: string = '';

  constructor(app: App) {
    this._app = app;
  }

  public getQuery(): string {
    return this._currentQuery;
  }

  public subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  public notify(): void {
    this._listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.error('[LegacyAdapter] Error en listener:', err);
      }
    });
  }

  public setSources(sources: Source[]): void {
    this._sources = sources;
    if (this._app.library && (this._app.library as any).setSourcesCache) {
      (this._app.library as any).setSourcesCache(sources);
    }
  }

  public setQuery(q: string): void {
    this._currentQuery = q;
    this._app.events.emit('query:change', { query: q });
  }

  public setToastHandler(fn: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void): void {
    this._toastHandler = fn;
  }

  public showToast(msg: string, type?: 'success' | 'warning' | 'error' | 'info'): void {
    if (this._toastHandler) {
      this._toastHandler(msg, type);
    } else {
      console.log(`[Toast] ${type || 'info'}: ${msg}`);
    }
  }

  public registerCardAction(action: CardActionDefinition): void {
    const idx = this._cardActions.findIndex(
      (a) => a.pluginId === action.pluginId && ((action.id && a.id === action.id) || a.label === action.label)
    );
    if (idx >= 0) {
      this._cardActions[idx] = action;
    } else {
      this._cardActions.push(action);
    }
    this.notify();
  }

  public getCardActions(): CardActionDefinition[] {
    return [...this._cardActions];
  }

  public registerChip(chip: ChipDefinition): void {
    const idx = this._chips.findIndex(
      (c) => (chip.pluginId ? c.pluginId === chip.pluginId && c.id === chip.id : c.id === chip.id)
    );
    if (idx >= 0) {
      this._chips[idx] = chip;
    } else {
      this._chips.push(chip);
    }
    this.notify();
  }

  public getChips(): ChipDefinition[] {
    return [...this._chips];
  }

  public registerSection(sec: SectionDefinition): void {
    const idx = this._sections.findIndex((s) => s.id === sec.id);
    if (idx >= 0) {
      this._sections[idx] = sec;
    } else {
      this._sections.push(sec);
    }
    this.notify();
    this._app.events.emit('sections:changed', this._sections);
  }

  public getSections(): SectionDefinition[] {
    return [...this._sections];
  }

  public registerIndexFlag(flag: IndexFlagConfig): void {
    const idx = this._indexFlags.findIndex((f) => f.id === flag.id);
    if (idx >= 0) {
      this._indexFlags[idx] = flag;
    } else {
      this._indexFlags.push(flag);
    }
    this.notify();
  }

  public getIndexFlags(): IndexFlagConfig[] {
    return [...this._indexFlags];
  }

  public getIndexFlag(sourceId: string, flagId: string): boolean {
    const s = this._sources.find((item) => item.id === sourceId);
    if (!s || !s.flags) return false;
    return !!s.flags[flagId];
  }

  public registerSourceAction(action: SourceActionConfig): void {
    const idx = this._sourceActions.findIndex(
      (a) => a.pluginId === action.pluginId && a.id === action.id
    );
    if (idx >= 0) {
      this._sourceActions[idx] = action;
    } else {
      this._sourceActions.push(action);
    }
    this.notify();
  }

  public getSourceActions(): SourceActionConfig[] {
    return [...this._sourceActions];
  }

  public registerSlotRenderer(slotName: string, renderer: { pluginId: string; render: (container: HTMLElement, context: any) => void }): void {
    if (!this._slotRenderers.has(slotName)) {
      this._slotRenderers.set(slotName, []);
    }
    const list = this._slotRenderers.get(slotName)!;
    const idx = list.findIndex((r) => r.pluginId === renderer.pluginId);
    if (idx >= 0) {
      list[idx] = renderer;
    } else {
      list.push(renderer);
    }
    this.notify();
  }

  public getSlotRenderers(slotName: string): Array<{ pluginId: string; render: (container: HTMLElement, context: any) => void }> {
    return this._slotRenderers.get(slotName) || [];
  }

  public registerView(viewDef: CustomViewDefinition, pluginId?: string): void {
    this._registeredViews.set(viewDef.id, { ...viewDef, pluginId });
    this.notify();
  }

  public getRegisteredViews(): CustomViewDefinition[] {
    return Array.from(this._registeredViews.values());
  }

  public getActiveView(): CustomViewDefinition | null {
    if (!this._activeViewId) return null;
    return this._registeredViews.get(this._activeViewId) || null;
  }

  public setActiveView(id: string | null): void {
    this._activeViewId = id;
    this.notify();
  }

  public overrideComponent(target: string, render: (container: HTMLElement, props: any) => void, pluginId: string): void {
    this._componentOverrides.set(target, { pluginId, target, render });
    this.notify();
  }

  public getComponentOverride(target: string): ComponentOverride | null {
    return this._componentOverrides.get(target) || null;
  }

  public registerPluginSettingsSchema(pluginId: string, schema: PluginSettingSchema[]): void {
    this._settingsSchemas.set(pluginId, schema);
    this.notify();
  }

  public getPluginSettingsSchema(pluginId: string): PluginSettingSchema[] {
    return this._settingsSchemas.get(pluginId) || [];
  }

  public registerCustomSettingsRenderer(pluginId: string, render: (container: HTMLElement) => void): void {
    this._customSettingsRenderers.set(pluginId, render);
    this.notify();
  }

  public getCustomSettingsRenderer(pluginId: string): ((container: HTMLElement) => void) | null {
    return this._customSettingsRenderers.get(pluginId) || null;
  }

  public async getPluginSetting(pluginId: string, key: string, defaultValue?: any): Promise<any> {
    const val = await this._app.storage.readJson<any>(`setting_${pluginId}_${key}`);
    return val !== null && val !== undefined ? val : defaultValue;
  }

  public async setPluginSetting(pluginId: string, key: string, value: any): Promise<void> {
    await this._app.storage.writeJson(`setting_${pluginId}_${key}`, value);
    this.notify();
  }

  public async runPipeline<T>(stage: string, context: T, fallback?: (ctx: T) => Promise<T> | T): Promise<T> {
    const middlewares = this._pipelineMiddlewares.get(stage) || [];
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

  public openModal(opts: any): void {
    const modalEl = document.getElementById('plugin-modal');
    const titleEl = document.getElementById('plugin-modal-title');
    const bodyEl = document.getElementById('plugin-modal-body');
    const actionsEl = document.getElementById('plugin-modal-actions');
    if (!modalEl || !titleEl || !bodyEl || !actionsEl) return;

    titleEl.textContent = opts.title || 'Plugin';

    const content = opts.html !== undefined ? opts.html : (opts.body !== undefined ? opts.body : '');
    if (typeof content === 'function') {
      bodyEl.replaceChildren();
      content(bodyEl);
    } else {
      bodyEl.innerHTML = String(content);
    }

    actionsEl.replaceChildren();
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

  public on(event: string, fn: (data: any) => void): () => void {
    const ref = this._app.events.on(event, fn);
    return () => {
      this._app.events.off(ref);
    };
  }

  public emit(event: string, data?: any): void {
    this._app.events.emit(event, data);
  }

  public teardownPlugin(pluginId: string): void {
    this._cardActions = this._cardActions.filter((a) => a.pluginId !== pluginId);
    this._chips = this._chips.filter((c) => c.pluginId !== pluginId);
    this._sections = this._sections.filter((s) => s.pluginId !== pluginId);
    this._indexFlags = this._indexFlags.filter((f) => f.pluginId !== pluginId);
    this._sourceActions = this._sourceActions.filter((a) => a.pluginId !== pluginId);

    for (const [vId, vDef] of this._registeredViews.entries()) {
      if (vDef.pluginId === pluginId) {
        this._registeredViews.delete(vId);
        if (this._activeViewId === vId) this._activeViewId = null;
      }
    }
    for (const [target, override] of this._componentOverrides.entries()) {
      if (override.pluginId === pluginId) {
        this._componentOverrides.delete(target);
      }
    }

    (this._app.events as any).purgePlugin?.(pluginId);
    this.notify();
  }

  public loadPlugins(plugins: LoadedPlugin[]): void {
    // Configurar global window.IndexLy
    installLegacyAdapter(this._app);

    // Conectar fachada con PluginHost
    for (const p of plugins) {
      if (p.manifest.settings && Array.isArray(p.manifest.settings)) {
        this.registerPluginSettingsSchema(p.manifest.id, p.manifest.settings);
      }
    }
  }
}

/**
 * Instala la fachada `window.IndexLy` retrocompatible en el objeto global.
 */
export function installLegacyAdapter(app: App): void {
  if (typeof window === 'undefined') return;

  (window as any).IndexLy = {
    apiVersion: 3,

    getSections: () => {
      return (window as any).__indexly_get_sections ? (window as any).__indexly_get_sections() : [];
    },

    register: (def: any) => {
      if (!hasWarnedLegacyRegister) {
        console.warn(
          '[Deprecation Warning] window.IndexLy.register() está deprecado. Las extensiones deben extender de la clase base Plugin de la API v1. Consulte docs/plugin-api/migration.md'
        );
        hasWarnedLegacyRegister = true;
      }
      const pluginId = def.id || (window as any).__current_register_plugin_id || 'unknown';
      if (typeof def.setup === 'function') {
        try {
          def.setup(app.legacy);
        } catch (err) {
          console.error(`[IndexLy Legacy] Error ejecutando setup de '${pluginId}':`, err);
        }
      }
    },

    plugin: (def: any) => {
      if (!hasWarnedLegacyPlugin) {
        console.warn(
          '[Deprecation Warning] window.IndexLy.plugin() está deprecado. Las extensiones deben extender de la clase base Plugin de la API v1. Consulte docs/plugin-api/migration.md'
        );
        hasWarnedLegacyPlugin = true;
      }
      const pluginId = def.id || (window as any).__current_register_plugin_id || 'unknown';
      if (typeof def.activate === 'function') {
        try {
          def.activate(app.legacy);
        } catch (err) {
          console.error(`[IndexLy Legacy] Error en activate de '${pluginId}':`, err);
        }
      } else if (typeof def.setup === 'function') {
        try {
          def.setup(app.legacy);
        } catch (err) {
          console.error(`[IndexLy Legacy] Error en setup de '${pluginId}':`, err);
        }
      }
    },
  };
}
