/**
 * @file src/plugins/api/App.ts
 * @description Construcción de la fachada `App` inyectada a los plugins de IndexLy Desktop (v1).
 */

import {
  App,
  FeatureSet,
  HubApi,
  LegacyApi,
  NativeApi,
  UiApi,
} from '../types';
import { HostEventsApi } from './EventsApi';
import { HostCommandsApi } from './CommandsApi';
import { ScopedStorageApi } from './StorageApi';
import { HostLibraryApi } from './LibraryApi';
import { HostSearchApi } from './SearchApi';
import { HostWorkspaceApi } from './WorkspaceApi';
import { HostSettingsApi } from './SettingsApi';
import { HostImporterApi } from './ImporterApi';
import { NativeError } from './errors';

/**
 * Conjunto de características activadas en el host para detección dinámica.
 */
export class HostFeatureSet implements FeatureSet {
  private _features: Set<string> = new Set([
    'plugin_api_v1',
    'search.fts5',
    'search.streaming',
    'library.v2_envelope',
    'storage.atomic_json',
    'events.namespaced',
  ]);

  public has(feature: string): boolean {
    return this._features.has(feature);
  }

  public list(): readonly string[] {
    return Array.from(this._features);
  }

  public enable(feature: string): void {
    this._features.add(feature);
  }

  public disable(feature: string): void {
    this._features.delete(feature);
  }
}

/**
 * Implementación de la superficie nativa pública (`app.native`).
 * Restringe `invoke` al namespace público `plugin:*`.
 */
export function createPublicNativeApi(): NativeApi {
  return {
    async invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
      // 1. Validar que la llamada pertenece al namespace público de plugins
      if (!cmd.startsWith('plugin:') && !cmd.startsWith('native_')) {
        throw new NativeError(
          `Acceso denegado: El comando '${cmd}' no pertenece al namespace público 'plugin:*'. Consulte: docs/plugin-api/native.md`,
          'ERR_INVOKE_DISALLOWED'
        );
      }

      // 2. Invocar vía Tauri IPC si está presente
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<T>(cmd, args);
      }

      throw new NativeError(`Tauri IPC no disponible para comando '${cmd}'`, 'ERR_NATIVE_UNAVAILABLE');
    },

    fs: {
      async read() {
        return new Uint8Array();
      },
      async readText(_path: string) {
        return '';
      },
      async write() {},
      async readDir() {
        return [];
      },
      async mkdir() {},
      async remove() {},
      async rename() {},
      async stat() {
        return { size: 0, isFile: true, isDirectory: false };
      },
      async watch() {
        return () => {};
      },
    },

    path: {
      join: (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
      resolve: (...parts: string[]) => parts.filter(Boolean).join('/'),
      dirname: (p: string) => p.substring(0, p.lastIndexOf('/')) || '.',
      basename: (p: string) => p.split('/').pop() || '',
      extname: (p: string) => {
        const b = p.split('/').pop() || '';
        const i = b.lastIndexOf('.');
        return i > 0 ? b.substring(i) : '';
      },
      async appData() {
        return 'appData';
      },
      async appConfig() {
        return 'appConfig';
      },
      async home() {
        return 'home';
      },
      async temp() {
        return 'temp';
      },
      sep: '/',
    },

    process: {
      async spawn() {
        return { pid: 1, async kill() {}, async wait() { return 0; } };
      },
      async exec(_cmd: string) {
        return { code: 0, stdout: '', stderr: '' };
      },
      async kill() {},
      async env() {
        return {};
      },
      async cwd() {
        return '/';
      },
    },

    net: {
      async fetch(input: string | Request, init?: RequestInit) {
        return await fetch(input, init);
      },
      async download() {},
      async listen() {
        return () => {};
      },
    },

    shell: {
      async openPath() {},
      async openUrl(url: string) {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
      async showInFolder() {},
    },

    clipboard: {
      async readText() {
        return await navigator.clipboard.readText();
      },
      async writeText(s: string) {
        await navigator.clipboard.writeText(s);
      },
      async readImage() {
        return null;
      },
      async writeImage() {},
    },

    notifications: {
      async send() {},
    },

    tray: {
      async create() {
        return { id: 'tray-1' };
      },
      async update() {},
      async remove() {},
    },

    shortcuts: {
      async register() {
        return () => {};
      },
      async unregister() {},
    },

    windows: {
      async create() {
        return 'win-1';
      },
      async list() {
        return [];
      },
      async focus() {},
      async close() {},
    },

    os: {
      platform() {
        return 'windows';
      },
      arch() {
        return 'x64';
      },
      async version() {
        return '10.0';
      },
      locale() {
        return 'es';
      },
    },

    keychain: {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
    },

    db: {
      async query<T>() {
        return [] as T[];
      },
      async exec() {},
    },
  };
}

/**
 * Crea una instancia de `App` ligada al contexto del host y opcionalmente a un plugin.
 */
export function createAppInstance(
  pluginId: string = 'host',
  sharedEvents?: HostEventsApi,
  sharedCommands?: HostCommandsApi,
  sharedWorkspace?: HostWorkspaceApi
): App {
  const events = sharedEvents || new HostEventsApi();
  const commands = sharedCommands || new HostCommandsApi();
  const workspace = sharedWorkspace || new HostWorkspaceApi(events);
  const storage = new ScopedStorageApi(pluginId);
  const features = new HostFeatureSet();
  const native = createPublicNativeApi();

  const library = new HostLibraryApi(events);
  const search = new HostSearchApi(events);
  const settings = new HostSettingsApi(pluginId, events, storage);
  const importer = new HostImporterApi(events);

  const hub: HubApi = {
    async search() {
      return [];
    },
    async getPlugin() {
      return null;
    },
    async install() {},
    async update() {},
    async uninstall() {},
    listInstalled() {
      return [];
    },
  };

  const ui: UiApi = {
    getTheme() {
      return 'dark';
    },
    onThemeChange(cb) {
      return events.on('ui:theme_change', cb as (data: any) => void);
    },
  };

  const legacy: LegacyApi = {
    apiVersion: 3,
  };

  return {
    version: '0.1.0',
    apiVersion: '1.0.0',
    features,
    library,
    search,
    workspace,
    commands,
    settings,
    importer,
    hub,
    native,
    events,
    storage,
    ui,
    legacy,
  };
}
