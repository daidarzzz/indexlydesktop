/**
 * @file src/plugins/host/PluginHost.ts
 * @description Orquestador central del ciclo de vida, carga y descarte de plugins para IndexLy Desktop (v1).
 *
 * `PluginHost` es el único propietario del runtime de plugins. `PluginRegistry` actúa
 * como fachada de UI y compatibilidad, pero no carga bundles ni mantiene un segundo
 * conjunto de instancias activas.
 */

import { App, LoadedPluginInfo, PluginManifest } from '../types';
import { Plugin } from '../api/Plugin';
import { createAppInstance } from '../api/App';
import { HostEventsApi } from '../api/EventsApi';
import { HostCommandsApi } from '../api/CommandsApi';
import { HostWorkspaceApi } from '../api/WorkspaceApi';
import { pluginLoader } from './PluginLoader';
import { generationManager } from './generation';
import { safeCallManager } from './SafeCall';
import { safeModeManager } from './SafeMode';
import { PluginTimeoutError } from '../api/errors';

/** Tipo de runtime que ejecuta un plugin. */
export type PluginRuntimeKind = 'modern' | 'legacy';

/**
 * Estado explícito del ciclo de vida de un plugin.
 *
 * - `inactive`: registrado pero no cargado.
 * - `loading`: `onload()` en curso.
 * - `active`: cargado y operativo.
 * - `unloading`: `onunload()`/limpieza en curso.
 * - `failed`: la última activación falló (timeout, excepción o runtime ausente).
 */
export type PluginState = 'inactive' | 'loading' | 'active' | 'unloading' | 'failed';

/** Forma mínima que debe cumplir una instancia devuelta por un adaptador de runtime. */
export interface PluginRuntimeInstance {
  onload?(): void | Promise<void>;
  onunload?(): void | Promise<void>;
  unload?(): void | Promise<void>;
  _generationId?: number;
}

/**
 * Adaptador de runtime. Permite que el host ejecute tanto plugins modernos
 * (CommonJS + `require('indexly')`) como extensiones legacy (`window.IndexLy`).
 */
export interface PluginRuntimeAdapter {
  readonly kind: PluginRuntimeKind;
  load(manifest: PluginManifest, code: string, app: App): PluginRuntimeInstance | Promise<PluginRuntimeInstance>;
  unload?(instance: PluginRuntimeInstance, manifest: PluginManifest): void | Promise<void>;
}

/** Opciones de registro de un plugin. */
export interface RegisterPluginOptions {
  /** Runtime explícito. Por defecto se infiere del manifiesto (nunca del bundle). */
  runtime?: PluginRuntimeKind;
  /** Etiqueta de origen para diagnóstico. */
  origin?: string;
}

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  code: string;
  styles?: string;
  instance?: PluginRuntimeInstance;
  generationId: number;
  state: PluginState;
  runtime: PluginRuntimeKind;
  origin?: string;
  hasError: boolean;
  lastError?: string;
}

/**
 * Infiere el runtime a partir del manifiesto *sin normalizar*.
 *
 * Un manifiesto legacy es aquel que no declara `schemaVersion` ni `minHostVersion`.
 * No se inspecciona el contenido del bundle: esa heurística era frágil y ejecutaba
 * plugins en el runtime equivocado.
 */
export function detectPluginRuntime(rawManifest: unknown): PluginRuntimeKind {
  if (!rawManifest || typeof rawManifest !== 'object') return 'legacy';
  const manifest = rawManifest as Record<string, unknown>;
  const hasSchemaVersion = typeof manifest.schemaVersion === 'number';
  const hasMinHostVersion = typeof manifest.minHostVersion === 'string' && manifest.minHostVersion.trim() !== '';
  return hasSchemaVersion || hasMinHostVersion ? 'modern' : 'legacy';
}

/**
 * Adaptador por defecto para la API v1 (bundles CommonJS).
 */
export class ModernRuntimeAdapter implements PluginRuntimeAdapter {
  public readonly kind: PluginRuntimeKind = 'modern';

  public load(manifest: PluginManifest, code: string, app: App): PluginRuntimeInstance {
    return pluginLoader.loadPluginInstance(code, manifest, app);
  }
}

const ONLOAD_TIMEOUT_MS = 10_000;
const ONUNLOAD_TIMEOUT_MS = 5_000;

/**
 * Host central de ejecución de plugins de IndexLy Desktop.
 */
export class PluginHost {
  /** Feature flag de la API v1 */
  public featureFlag: boolean = true;
  /** Mapa privado de plugins registrados en el sistema */
  private _plugins: Map<string, PluginRegistryEntry> = new Map();
  /** Cola de operaciones por plugin para serializar enable/disable/reload */
  private _locks: Map<string, Promise<unknown>> = new Map();
  /** Adaptadores de runtime disponibles */
  private _adapters: Map<PluginRuntimeKind, PluginRuntimeAdapter> = new Map();
  /** Instancia compartida de eventos */
  public readonly sharedEvents: HostEventsApi;
  /** Instancia compartida de comandos */
  public readonly sharedCommands: HostCommandsApi;
  /** Instancia compartida del workspace */
  public readonly sharedWorkspace: HostWorkspaceApi;
  /** App raíz del host */
  public readonly app: App;

  constructor(
    sharedEvents?: HostEventsApi,
    sharedCommands?: HostCommandsApi,
    sharedWorkspace?: HostWorkspaceApi
  ) {
    this.sharedEvents = sharedEvents || new HostEventsApi();
    this.sharedCommands = sharedCommands || new HostCommandsApi();
    this.sharedWorkspace = sharedWorkspace || new HostWorkspaceApi(this.sharedEvents);
    this.app = createAppInstance('host', this.sharedEvents, this.sharedCommands, this.sharedWorkspace, this);

    this.registerRuntimeAdapter(new ModernRuntimeAdapter());

    // Escuchar cuando un plugin supera el límite de fallos
    safeCallManager.onThresholdExceeded((pluginId, errorCount) => {
      console.warn(
        `[PluginHost] El plugin '${pluginId}' superó el umbral con ${errorCount} errores. Desactivando preventivamente.`
      );
      this.disablePlugin(pluginId).catch((err) => {
        console.error(`[PluginHost] Error desactivando plugin '${pluginId}':`, err);
      });
    });
  }

  /**
   * Registra un adaptador de runtime (moderno o legacy).
   */
  public registerRuntimeAdapter(adapter: PluginRuntimeAdapter): void {
    this._adapters.set(adapter.kind, adapter);
  }

  /**
   * Registra un plugin en el catálogo del host a partir de su código y manifiesto.
   *
   * Si el plugin ya estaba registrado se reemplaza su código, pero **no** se
   * reinicia automáticamente: el llamador decide si desea `reloadPlugin()`.
   */
  public registerPlugin(
    manifest: PluginManifest,
    code: string,
    styles?: string,
    options: RegisterPluginOptions = {}
  ): void {
    if (!manifest || !manifest.id) {
      throw new Error('[PluginHost] registerPlugin requiere un manifiesto con id válido');
    }

    const previous = this._plugins.get(manifest.id);
    const runtime = options.runtime ?? detectPluginRuntime(manifest);

    this._plugins.set(manifest.id, {
      manifest,
      code,
      styles,
      instance: previous?.instance,
      generationId: previous?.generationId ?? 0,
      state: previous?.state ?? 'inactive',
      runtime,
      origin: options.origin ?? previous?.origin,
      hasError: previous?.hasError ?? false,
      lastError: previous?.lastError,
    });
  }

  /**
   * Indica si el bundle o los estilos registrados difieren de los almacenados.
   *
   * Se usa antes de `registerPlugin()` para decidir si un plugin activo debe
   * recargarse: reemplazar el código sin reiniciar dejaría la instancia vieja
   * ejecutándose indefinidamente.
   */
  public hasBundleChanged(id: string, code: string, styles?: string): boolean {
    const entry = this._plugins.get(id);
    if (!entry) return true;
    return entry.code !== code || entry.styles !== styles;
  }

  /**
   * Indica si un plugin está registrado en el host.
   */
  public hasPlugin(id: string): boolean {
    return this._plugins.has(id);
  }

  /**
   * Obtiene el estado actual de un plugin.
   */
  public getPluginState(id: string): PluginState | undefined {
    return this._plugins.get(id)?.state;
  }

  /**
   * Activa y carga un plugin registrado ejecutando su ciclo `onload` con límite de 10 segundos.
   * @param id Identificador del plugin
   * @returns `true` si se cargó con éxito; `false` si falló o fue cancelado
   */
  public enablePlugin(id: string): Promise<boolean> {
    return this.runExclusive(id, () => this.enablePluginUnlocked(id));
  }

  /**
   * Desactiva y descarga un plugin ejecutando su hook `onunload` y desregistrando recursos LIFO.
   * @param id Identificador del plugin
   * @returns `true` si la descarga se completó
   */
  public disablePlugin(id: string): Promise<boolean> {
    return this.runExclusive(id, () => this.disablePluginUnlocked(id));
  }

  /**
   * Recarga un plugin ejecutando una secuencia completa de descarga y activación.
   * @param id Identificador del plugin
   */
  public reloadPlugin(id: string): Promise<boolean> {
    return this.runExclusive(id, async () => {
      await this.disablePluginUnlocked(id);
      return this.enablePluginUnlocked(id);
    });
  }

  /**
   * Comprueba si un plugin se encuentra cargado y activo.
   */
  public isPluginLoaded(id: string): boolean {
    return this._plugins.get(id)?.state === 'active';
  }

  /**
   * Obtiene la instancia activa de un plugin.
   */
  public getPluginInstance(id: string): PluginRuntimeInstance | undefined {
    return this._plugins.get(id)?.instance;
  }

  /**
   * Lista el estado de todos los plugins registrados en el host.
   */
  public getLoadedPlugins(): LoadedPluginInfo[] {
    const result: LoadedPluginInfo[] = [];
    for (const entry of this._plugins.values()) {
      result.push({
        manifest: entry.manifest,
        isLoaded: entry.state === 'active',
        hasError: entry.hasError,
        errorCount: safeCallManager.getRecentErrorCount(entry.manifest.id),
        lastError: entry.lastError,
        state: entry.state,
        runtime: entry.runtime,
      });
    }
    return result;
  }

  /**
   * Limpia y descarga todos los plugins activos (usado al cerrar la app o en tests).
   */
  public async unloadAll(): Promise<void> {
    for (const id of Array.from(this._plugins.keys())) {
      await this.disablePlugin(id);
    }
    this._plugins.clear();
    this._locks.clear();
  }

  // --------------------------------------------------------------------------
  // Implementación interna (siempre se ejecuta dentro del lock del plugin)
  // --------------------------------------------------------------------------

  private async enablePluginUnlocked(id: string): Promise<boolean> {
    const entry = this._plugins.get(id);
    if (!entry) {
      console.warn(`[PluginHost] No se puede activar '${id}': no está registrado`);
      return false;
    }

    // 1. Validar si el Modo Restringido o Modo Seguro impiden la carga
    if (!safeModeManager.canLoadPlugins()) {
      console.warn(`[PluginHost] Carga bloqueada para '${id}' por Modo Seguro o Modo Restringido activo`);
      return false;
    }

    // 2. Si ya está activo, no duplicar listeners ni instancias
    if (entry.state === 'active' && entry.instance) {
      return true;
    }

    const adapter = this._adapters.get(entry.runtime);
    if (!adapter) {
      entry.state = 'failed';
      entry.hasError = true;
      entry.lastError = `No hay adaptador de runtime '${entry.runtime}' registrado para '${id}'`;
      console.error(`[PluginHost] ${entry.lastError}`);
      this.sharedEvents.emit('plugin:failed', { id, error: entry.lastError, runtime: entry.runtime });
      return false;
    }

    // 3. Asignar nuevo token de generación atómico
    const generationId = generationManager.nextGeneration(id);
    entry.generationId = generationId;
    entry.state = 'loading';
    entry.hasError = false;
    entry.lastError = undefined;

    // 4. Instanciar el plugin mediante el adaptador de runtime
    const scopedApp = createAppInstance(id, this.sharedEvents, this.sharedCommands, this.sharedWorkspace, this);
    let instance: PluginRuntimeInstance;

    try {
      instance = await adapter.load(entry.manifest, entry.code, scopedApp);
      instance._generationId = generationId;
      entry.instance = instance;
    } catch (err) {
      await this.failActivation(id, entry, err);
      return false;
    }

    // 5. Inyectar estilos CSS si existen
    if (entry.styles && entry.styles.trim()) {
      this.injectStyles(id, entry.styles);
    }

    // 6. Ejecutar onload() como hook crítico: si falla, el plugin NO queda cargado
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new PluginTimeoutError(id, 'onload', ONLOAD_TIMEOUT_MS));
      }, ONLOAD_TIMEOUT_MS);
    });

    const onloadPromise = safeCallManager.safeCallCritical(
      id,
      () => instance.onload?.(),
      'lifecycle:onload'
    );

    try {
      await Promise.race([onloadPromise, timeoutPromise]);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      // Comprobar que durante onload el plugin no haya sido invalidado
      if (!generationManager.isValid(id, generationId)) {
        console.warn(`[PluginHost] onload() completó pero el generationId fue invalidado para '${id}'`);
        await this.cleanupInstance(id, entry, instance);
        entry.state = 'inactive';
        entry.instance = undefined;
        return false;
      }

      entry.state = 'active';
      this.sharedEvents.emit('plugin:enabled', { id, manifest: entry.manifest });
      return true;
    } catch (err) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      await this.failActivation(id, entry, err);

      // Si onload termina tarde tras el timeout, limpiar los recursos que registre
      onloadPromise
        .then(async () => {
          if (!generationManager.isValid(id, generationId)) {
            await this.cleanupInstance(id, entry, instance);
          }
        })
        .catch(() => {
          // El error ya fue registrado y atribuido por safeCallCritical
        });

      return false;
    }
  }

  private async disablePluginUnlocked(id: string): Promise<boolean> {
    const entry = this._plugins.get(id);
    if (!entry) {
      return false;
    }

    const instance = entry.instance;
    if (!instance) {
      // Nada que descargar: normalizar el estado para permitir una futura activación.
      if (entry.state !== 'failed') entry.state = 'inactive';
      return false;
    }

    entry.state = 'unloading';

    // 1. Invalidar token de generación inmediatamente para desarmar llamadas tardías
    generationManager.invalidate(id);

    // 2. Ejecutar onunload() con timeout de 5 segundos (no bloquea la purga)
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutTimer = setTimeout(() => {
        console.warn(`[PluginHost] onunload() superó el límite de 5s para '${id}'. Forzando purga LIFO.`);
        resolve();
      }, ONUNLOAD_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        safeCallManager.safeCallCritical(id, () => instance.onunload?.(), 'lifecycle:onunload'),
        timeoutPromise,
      ]);
    } catch (err) {
      console.error(`[PluginHost] Excepción en onunload() de '${id}':`, err);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    // 3. Purgar recursos del plugin (LIFO, eventos, estilos y adapter)
    await this.cleanupInstance(id, entry, instance);

    // 4. Actualizar estado
    entry.state = 'inactive';
    entry.instance = undefined;
    entry.generationId = 0;

    this.sharedEvents.emit('plugin:disabled', { id });
    return true;
  }

  /**
   * Marca una activación como fallida y desmonta cualquier recurso parcial.
   */
  private async failActivation(id: string, entry: PluginRegistryEntry, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PluginHost] Error cargando plugin '${id}':`, err);
    entry.hasError = true;
    entry.lastError = message;
    generationManager.invalidate(id);

    if (entry.instance) {
      await this.cleanupInstance(id, entry, entry.instance);
    } else {
      this.removeStyles(id);
      this.sharedEvents.purgePlugin(id);
    }

    entry.instance = undefined;
    entry.state = 'failed';
    this.sharedEvents.emit('plugin:failed', { id, error: message, runtime: entry.runtime });
  }

  /**
   * Ejecuta la limpieza determinista de una instancia: adapter, LIFO, eventos y estilos.
   * Es idempotente y tolerante a fallos para no dejar recursos huérfanos.
   */
  private async cleanupInstance(
    id: string,
    entry: PluginRegistryEntry,
    instance: PluginRuntimeInstance
  ): Promise<void> {
    const adapter = this._adapters.get(entry.runtime);
    try {
      await adapter?.unload?.(instance, entry.manifest);
    } catch (err) {
      console.error(`[PluginHost] Error en cleanup del adaptador '${entry.runtime}' para '${id}':`, err);
    }

    try {
      await instance.unload?.();
    } catch (err) {
      console.error(`[PluginHost] Error purgando disposables de '${id}':`, err);
    }

    this.sharedEvents.purgePlugin(id);
    this.removeStyles(id);
  }

  /**
   * Serializa las operaciones de un mismo plugin. Operaciones sobre plugins
   * distintos siguen ejecutándose en paralelo.
   */
  private runExclusive<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this._locks.get(id) ?? Promise.resolve();
    const next = previous.then(task, task);
    // Mantener la cola viva pero sin propagar rechazos a operaciones posteriores.
    this._locks.set(
      id,
      next.catch(() => undefined)
    );
    return next;
  }

  /**
   * Inyecta una hoja de estilos CSS etiquetada con `data-plugin-id`.
   */
  private injectStyles(pluginId: string, cssText: string): void {
    if (typeof document === 'undefined') return;

    let styleEl = document.querySelector(`style[data-plugin-id="${pluginId}"]`) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-plugin-id', pluginId);
      styleEl.setAttribute('data-plugin', pluginId);
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = cssText;
  }

  /**
   * Elimina la hoja de estilos CSS de un plugin.
   */
  private removeStyles(pluginId: string): void {
    if (typeof document === 'undefined') return;
    document.querySelectorAll(`style[data-plugin-id="${pluginId}"], style[data-plugin="${pluginId}"]`).forEach((el) => {
      el.remove();
    });
  }
}

export const pluginHost = new PluginHost();

// Reexportar el tipo `Plugin` para consumidores que lo necesiten sin importar la API base.
export type { Plugin };
