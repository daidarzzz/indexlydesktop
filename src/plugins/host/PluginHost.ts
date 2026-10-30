/**
 * @file src/plugins/host/PluginHost.ts
 * @description Orquestador central del ciclo de vida, carga y descarte de plugins para IndexLy Desktop (v1).
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

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  code: string;
  styles?: string;
  instance?: Plugin;
  generationId: number;
  isLoaded: boolean;
  hasError: boolean;
  lastError?: string;
}

/**
 * Host central de ejecución de plugins de IndexLy Desktop.
 */
export class PluginHost {
  /** Feature flag de la API v1 */
  public featureFlag: boolean = true;
  /** Mapa privado de plugins registrados en el sistema */
  private _plugins: Map<string, PluginRegistryEntry> = new Map();
  /** Instancia compartida de eventos */
  public readonly sharedEvents: HostEventsApi = new HostEventsApi();
  /** Instancia compartida de comandos */
  public readonly sharedCommands: HostCommandsApi = new HostCommandsApi();
  /** Instancia compartida del workspace */
  public readonly sharedWorkspace: HostWorkspaceApi;
  /** App raíz del host */
  public readonly app: App;

  constructor() {
    this.sharedWorkspace = new HostWorkspaceApi(this.sharedEvents);
    this.app = createAppInstance('host', this.sharedEvents, this.sharedCommands, this.sharedWorkspace);

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
   * Registra un plugin en el catálogo del host a partir de su código y manifiesto.
   */
  public registerPlugin(manifest: PluginManifest, code: string, styles?: string): void {
    if (!manifest || !manifest.id) {
      throw new Error('[PluginHost] registerPlugin requiere un manifiesto con id válido');
    }

    this._plugins.set(manifest.id, {
      manifest,
      code,
      styles,
      generationId: 0,
      isLoaded: false,
      hasError: false,
    });
  }

  /**
   * Activa y carga un plugin registrado ejecutando su ciclo `onload` con límite de 10 segundos.
   * @param id Identificador del plugin
   * @returns `true` si se cargó con éxito; `false` si falló o fue cancelado
   */
  public async enablePlugin(id: string): Promise<boolean> {
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

    // 2. Si ya está cargado, ignorar
    if (entry.isLoaded && entry.instance) {
      return true;
    }

    // 3. Asignar nuevo token de generación atómico
    const generationId = generationManager.nextGeneration(id);
    entry.generationId = generationId;
    entry.hasError = false;
    entry.lastError = undefined;

    // 4. Instanciar el plugin mediante el loader CJS
    const scopedApp = createAppInstance(id, this.sharedEvents, this.sharedCommands, this.sharedWorkspace);
    let instance: Plugin;

    try {
      instance = pluginLoader.loadPluginInstance(entry.code, entry.manifest, scopedApp);
      instance._generationId = generationId;
      entry.instance = instance;
    } catch (err) {
      entry.hasError = true;
      entry.lastError = (err as Error).message;
      generationManager.invalidate(id);
      return false;
    }

    // 5. Inyectar estilos CSS si existen
    if (entry.styles && entry.styles.trim()) {
      this.injectStyles(id, entry.styles);
    }

    // 6. Ejecutar onload() con timeout estricto de 10 segundos
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new PluginTimeoutError(id, 'onload', 10000));
      }, 10000);
    });

    try {
      await Promise.race([
        safeCallManager.safeCall(id, () => instance.onload(), 'lifecycle:onload'),
        timeoutPromise,
      ]);

      if (timeoutTimer) clearTimeout(timeoutTimer);

      // Comprobar que durante onload el plugin no haya sido invalidado
      if (!generationManager.isValid(id, generationId)) {
        console.warn(`[PluginHost] onload() completó pero el generationId fue invalidado para '${id}'`);
        await this.disablePlugin(id);
        return false;
      }

      entry.isLoaded = true;
      this.sharedEvents.emit('plugin:enabled', { id, manifest: entry.manifest });
      return true;
    } catch (err) {
      if (timeoutTimer) clearTimeout(timeoutTimer);

      console.error(`[PluginHost] Error cargando plugin '${id}':`, err);
      entry.hasError = true;
      entry.lastError = (err as Error).message;

      // Inmediatamente invalidar generationId y desmantelar recursos
      generationManager.invalidate(id);
      this.removeStyles(id);
      try {
        await instance.unload();
      } catch {
        // Ignorar fallos de limpieza forzosa
      }
      entry.isLoaded = false;
      entry.instance = undefined;
      return false;
    }
  }

  /**
   * Desactiva y descarga un plugin ejecutando su hook `onunload` y desregistrando recursos LIFO.
   * @param id Identificador del plugin
   * @returns `true` si la descarga se completó
   */
  public async disablePlugin(id: string): Promise<boolean> {
    const entry = this._plugins.get(id);
    if (!entry || !entry.instance) {
      return false;
    }

    const instance = entry.instance;

    // 1. Invalidar token de generación inmediatamente para desarmar llamadas tardías
    generationManager.invalidate(id);

    // 2. Ejecutar onunload() con timeout de 5 segundos
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutTimer = setTimeout(() => {
        console.warn(`[PluginHost] onunload() superó el límite de 5s para '${id}'. Forzando purga LIFO.`);
        resolve();
      }, 5000);
    });

    try {
      await Promise.race([
        safeCallManager.safeCall(id, () => instance.onunload(), 'lifecycle:onunload'),
        timeoutPromise,
      ]);
    } catch (err) {
      console.error(`[PluginHost] Excepción en onunload() de '${id}':`, err);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    // 3. Ejecutar descarte LIFO de todos los disposables (eventos, comandos, timers, dom)
    try {
      await instance.unload();
    } catch (err) {
      console.error(`[PluginHost] Error purgando disposables de '${id}':`, err);
    }

    // 4. Purgar eventos de eventsApi y estilos CSS
    this.sharedEvents.purgePlugin(id);
    this.removeStyles(id);

    // 5. Actualizar estado
    entry.isLoaded = false;
    entry.instance = undefined;
    entry.generationId = 0;

    this.sharedEvents.emit('plugin:disabled', { id });
    return true;
  }

  /**
   * Recarga un plugin ejecutando una secuencia completa de descarga y activación.
   * @param id Identificador del plugin
   */
  public async reloadPlugin(id: string): Promise<boolean> {
    await this.disablePlugin(id);
    return await this.enablePlugin(id);
  }

  /**
   * Comprueba si un plugin se encuentra cargado y activo.
   */
  public isPluginLoaded(id: string): boolean {
    return !!this._plugins.get(id)?.isLoaded;
  }

  /**
   * Obtiene la instancia activa de un plugin.
   */
  public getPluginInstance(id: string): Plugin | undefined {
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
        isLoaded: entry.isLoaded,
        hasError: entry.hasError,
        errorCount: safeCallManager.getRecentErrorCount(entry.manifest.id),
        lastError: entry.lastError,
      });
    }
    return result;
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
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = cssText;
  }

  /**
   * Elimina la hoja de estilos CSS de un plugin.
   */
  private removeStyles(pluginId: string): void {
    if (typeof document === 'undefined') return;
    const styleEl = document.querySelector(`style[data-plugin-id="${pluginId}"]`);
    if (styleEl) {
      styleEl.remove();
    }
  }

  /**
   * Limpia y descarga todos los plugins activos (usado al cerrar la app o en tests).
   */
  public async unloadAll(): Promise<void> {
    for (const id of Array.from(this._plugins.keys())) {
      if (this.isPluginLoaded(id)) {
        await this.disablePlugin(id);
      }
    }
    this._plugins.clear();
  }
}

export const pluginHost = new PluginHost();
