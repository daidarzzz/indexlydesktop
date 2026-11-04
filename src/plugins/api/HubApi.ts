/**
 * @file src/plugins/api/HubApi.ts
 * @description Implementación del módulo `app.hub` para búsqueda, instalación, actualización y auditoría de plugins.
 */

import { HubApi, HubPluginDetail, HubPluginSummary, LoadedPluginInfo } from '../types';
import { PluginHost } from '../host/PluginHost';
import { calculatePermissionDiff, validateAndNormalizeManifest } from '../manifest/validator';
import { ValidationError } from './errors';

/**
 * Implementación de la API del Hub oficial de plugins (`app.hub`).
 */
export class HostHubApi implements HubApi {
  private _host?: PluginHost | (() => PluginHost | undefined);
  private _cachedDirectory: HubPluginDetail[] = [
    {
      id: 'com.indexly.csv-importer',
      name: 'CSV & Tabular Importer',
      version: '1.0.0',
      description: 'Importador universal para fuentes de datos tabulares, CSV y TSV.',
      author: 'IndexLy Team',
      downloads: 1420,
      permissions: ['fs:read'],
      minHostVersion: '0.1.0',
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    {
      id: 'com.indexly.readly-view',
      name: 'ReadLy Reader View',
      version: '1.2.0',
      description: 'Modo lectura sin distracciones para artículos y documentación.',
      author: 'IndexLy Team',
      downloads: 3850,
      permissions: ['workspace.views'],
      minHostVersion: '0.1.0',
      hash: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
    },
  ];

  constructor(host?: PluginHost | (() => PluginHost | undefined)) {
    this._host = host;
  }

  private get host(): PluginHost | undefined {
    if (typeof this._host === 'function') {
      return this._host();
    }
    return this._host;
  }

  private getRequiredHost(): PluginHost {
    const h = this.host;
    if (!h) {
      throw new ValidationError('PluginHost no está disponible en este entorno');
    }
    return h;
  }

  /**
   * Busca plugins en el catálogo del Hub por término clave.
   * @param query Filtro de búsqueda
   */
  public async search(query: string): Promise<HubPluginSummary[]> {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      return this._cachedDirectory.map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        downloads: p.downloads,
      }));
    }

    return this._cachedDirectory
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q)
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        downloads: p.downloads,
      }));
  }

  /**
   * Obtiene la ficha de detalle de un plugin en el Hub, incluyendo permisos y hash.
   * @param id Identificador del plugin
   */
  public async getPlugin(id: string): Promise<HubPluginDetail | null> {
    const item = this._cachedDirectory.find((p) => p.id === id);
    return item ? { ...item } : null;
  }

  /**
   * Instala un plugin desde el Hub validando su manifiesto y hash.
   * @param id Identificador del plugin
   * @param _version Versión específica a instalar
   */
  public async install(id: string, _version?: string): Promise<void> {
    const detail = await this.getPlugin(id);
    if (!detail) {
      throw new ValidationError(`Plugin '${id}' no encontrado en el Hub`);
    }

    // Validar manifiesto antes de registrar
    const normalized = validateAndNormalizeManifest({
      id: detail.id,
      name: detail.name,
      version: detail.version,
      description: detail.description,
      author: detail.author,
      permissions: detail.permissions,
      hash: detail.hash,
      minHostVersion: detail.minHostVersion,
    });

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_hub_plugin', {
        id: normalized.id,
        name: normalized.name,
        code: `// ${normalized.name} v${normalized.version}\nconst { Plugin } = require('indexly');\nmodule.exports = class extends Plugin {};`,
      });
    }

    // Registrar en PluginHost sin activar: toda instalación nueva arranca
    // desactivada hasta que el usuario la habilite explícitamente.
    const defaultCode = `// ${normalized.name} v${normalized.version}\nconst { Plugin } = require('indexly');\nmodule.exports = class extends Plugin {\n  onload() {}\n  onunload() {}\n};`;
    const host = this.getRequiredHost();
    host.registerPlugin(normalized, defaultCode, undefined, { origin: 'hub:install' });
    host.sharedEvents.emit('plugin:installed', { id: normalized.id, enabled: false });
  }

  /**
   * Actualiza un plugin a su última versión, comprobando diferencias de permisos.
   * @param id Identificador del plugin
   */
  public async update(id: string): Promise<void> {
    const installed = this.listInstalled().find((p) => p.manifest.id === id);
    if (!installed) {
      throw new ValidationError(`El plugin '${id}' no está instalado`);
    }

    const detail = await this.getPlugin(id);
    if (!detail) {
      throw new ValidationError(`Plugin '${id}' no encontrado en el Hub para actualización`);
    }

    // Calcular elevación de permisos si la versión nueva requiere más permisos
    const diff = calculatePermissionDiff(installed.manifest.permissions, detail.permissions);
    if (diff.hasElevation) {
      console.warn(
        `[HubApi] El plugin '${id}' solicita nuevos permisos en la actualización: ${diff.added.join(', ')}`
      );
    }

    await this.install(id, detail.version);
  }

  /**
   * Desinstala un plugin, descargándolo y limpiando sus recursos.
   * @param id Identificador del plugin
   */
  public async uninstall(id: string): Promise<void> {
    const host = this.getRequiredHost();
    await host.disablePlugin(id);
    host.sharedEvents.emit('plugin:uninstalled', { id });
  }

  /**
   * Lista todos los plugins instalados en el host con su estado y auditoría de errores.
   */
  public listInstalled(): LoadedPluginInfo[] {
    return this.host ? this.host.getLoadedPlugins() : [];
  }
}
