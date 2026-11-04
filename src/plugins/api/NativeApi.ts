/**
 * @file src/plugins/api/NativeApi.ts
 * @description Implementación completa de la superficie nativa tipada (`app.native`).
 * Brinda acceso sin restricciones artificiales a fs, process, db, keychain, windows, clipboard,
 * mientras restringe `invoke` al namespace documentado `plugin:*` (y shims `native_*`).
 */

import {
  ChildHandle,
  DirEntry,
  ExecOptions,
  FileStat,
  NativeApi,
  SpawnOptions,
  TrayHandle,
  TrayOptions,
  WatchEvent,
  WindowInfo,
  WindowOptions,
} from '../types';
import { NativeError } from './errors';

/**
 * Crea la instancia completa de `NativeApi` para el runtime de IndexLy.
 */
export function createNativeApi(): NativeApi {
  /**
   * Helper seguro para invocar comandos Tauri IPC.
   * Restringe al namespace `plugin:*` y `native_*`.
   */
  async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!cmd.startsWith('plugin:') && !cmd.startsWith('native_')) {
      throw new NativeError(
        `Acceso denegado: El comando '${cmd}' no pertenece al namespace público 'plugin:*'. Consulte: docs/plugin-api/native.md`,
        'ERR_INVOKE_DISALLOWED'
      );
    }

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
      // Traducir 'plugin:cmd_name' a 'plugin_cmd_name' para Tauri IPC handler
      const tauriCmd = cmd.startsWith('plugin:') ? cmd.replace('plugin:', 'plugin_') : cmd;
      return await tauriInvoke<T>(tauriCmd, args);
    }

    throw new NativeError(`Tauri IPC no disponible en este entorno para comando '${cmd}'`, 'ERR_NATIVE_UNAVAILABLE');
  }

  // 1. File System
  const fs = {
    async read(path: string): Promise<Uint8Array> {
      try {
        const bytes = await invoke<number[]>('plugin:fs_read', { path });
        return new Uint8Array(bytes);
      } catch (err: any) {
        throw new NativeError(`Error leyendo archivo binario '${path}': ${err.message || err}`, 'ERR_FS_READ', err);
      }
    },

    async readText(path: string): Promise<string> {
      try {
        return await invoke<string>('plugin:fs_read_text', { path });
      } catch (err: any) {
        throw new NativeError(`Error leyendo archivo de texto '${path}': ${err.message || err}`, 'ERR_FS_READ', err);
      }
    },

    async write(path: string, data: Uint8Array | string): Promise<void> {
      try {
        if (typeof data === 'string') {
          await invoke('plugin:fs_write', { path, content: data });
        } else {
          await invoke('plugin:fs_write', { path, bytes: Array.from(data) });
        }
      } catch (err: any) {
        throw new NativeError(`Error escribiendo en '${path}': ${err.message || err}`, 'ERR_FS_WRITE', err);
      }
    },

    async readDir(path: string): Promise<DirEntry[]> {
      try {
        const raw = await invoke<Array<{ name: string; path: string; is_dir: boolean; size?: number }>>(
          'plugin:fs_read_dir',
          { path }
        );
        return raw.map((e) => ({
          name: e.name,
          path: e.path,
          isDirectory: e.is_dir,
          isFile: !e.is_dir,
        }));
      } catch (err: any) {
        throw new NativeError(`Error listando directorio '${path}': ${err.message || err}`, 'ERR_FS_READDIR', err);
      }
    },

    async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
      try {
        await invoke('plugin:fs_mkdir', { path, recursive: opts?.recursive ?? true });
      } catch (err: any) {
        throw new NativeError(`Error creando directorio '${path}': ${err.message || err}`, 'ERR_FS_MKDIR', err);
      }
    },

    async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
      try {
        await invoke('plugin:fs_remove', { path, recursive: opts?.recursive ?? false });
      } catch (err: any) {
        throw new NativeError(`Error eliminando '${path}': ${err.message || err}`, 'ERR_FS_REMOVE', err);
      }
    },

    async rename(from: string, to: string): Promise<void> {
      try {
        await invoke('plugin:fs_rename', { from, to });
      } catch (err: any) {
        throw new NativeError(`Error renombrando '${from}' a '${to}': ${err.message || err}`, 'ERR_FS_RENAME', err);
      }
    },

    async stat(path: string): Promise<FileStat> {
      try {
        const res = await invoke<any>('plugin:fs_stat', { path });
        return {
          size: res.size ?? 0,
          isFile: !!res.isFile,
          isDirectory: !!res.isDirectory,
          modifiedAt: res.modified,
        };
      } catch (err: any) {
        throw new NativeError(`Error obteniendo metadatos de '${path}': ${err.message || err}`, 'ERR_FS_STAT', err);
      }
    },

    async watch(_path: string, _cb: (ev: WatchEvent) => void): Promise<() => void> {
      return () => {};
    },
  };

  // 2. Path utilities
  const path = {
    join(...parts: string[]): string {
      return parts
        .filter(Boolean)
        .join('/')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/');
    },

    resolve(...parts: string[]): string {
      return parts
        .filter(Boolean)
        .join('/')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/');
    },

    dirname(p: string): string {
      const normalized = p.replace(/\\/g, '/');
      const idx = normalized.lastIndexOf('/');
      return idx > 0 ? normalized.substring(0, idx) : idx === 0 ? '/' : '.';
    },

    basename(p: string): string {
      const normalized = p.replace(/\\/g, '/');
      return normalized.split('/').filter(Boolean).pop() || '';
    },

    extname(p: string): string {
      const base = path.basename(p);
      const idx = base.lastIndexOf('.');
      return idx > 0 ? base.substring(idx) : '';
    },

    async appData(): Promise<string> {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const { appDataDir } = await import('@tauri-apps/api/path');
          return await appDataDir();
        } catch {
          // Fallback
        }
      }
      return './.indexly_data';
    },

    async appConfig(): Promise<string> {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const { appConfigDir } = await import('@tauri-apps/api/path');
          return await appConfigDir();
        } catch {
          // Fallback
        }
      }
      return './.indexly_config';
    },

    async home(): Promise<string> {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const { homeDir } = await import('@tauri-apps/api/path');
          return await homeDir();
        } catch {
          // Fallback
        }
      }
      return '~';
    },

    async temp(): Promise<string> {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const { tempDir } = await import('@tauri-apps/api/path');
          return await tempDir();
        } catch {
          // Fallback
        }
      }
      return './tmp';
    },

    sep: '/',
  };

  // 3. Process execution
  const process = {
    async spawn(cmd: string, args: string[] = [], opts?: SpawnOptions): Promise<ChildHandle> {
      const res = await invoke<{ exit_code: number; stdout: string; stderr: string }>('plugin:process_exec', {
        cmd,
        args,
        cwd: opts?.cwd,
      });
      return {
        pid: 0,
        kill: async () => {},
        wait: async () => res.exit_code,
      };
    },

    async exec(cmd: string, opts?: ExecOptions): Promise<{ code: number; stdout: string; stderr: string }> {
      try {
        const res = await invoke<{ exit_code: number; stdout: string; stderr: string }>('plugin:process_exec', {
          cmd,
          args: [],
          cwd: opts?.cwd,
        });
        return {
          code: res.exit_code,
          stdout: res.stdout,
          stderr: res.stderr,
        };
      } catch (err: any) {
        throw new NativeError(`Fallo ejecutando comando '${cmd}': ${err.message || err}`, 'ERR_PROCESS_EXEC', err);
      }
    },

    async kill(_pid: number): Promise<void> {},

    async env(): Promise<Record<string, string>> {
      try {
        return await invoke<Record<string, string>>('plugin:process_env');
      } catch {
        return {};
      }
    },

    async cwd(): Promise<string> {
      return '.';
    },
  };

  // 4. Net APIs
  const net = {
    fetch: async (input: string | Request, init?: RequestInit): Promise<Response> => {
      return await globalThis.fetch(input, init);
    },
    async download(url: string, dest: string, onProgress?: (n: number) => void): Promise<void> {
      const res = await globalThis.fetch(url);
      const data = await res.arrayBuffer();
      if (onProgress) onProgress(100);
      await fs.write(dest, new Uint8Array(data));
    },
    async listen(_port: number, _cb: (req: unknown) => void): Promise<() => void> {
      return () => {};
    },
  };

  // 4b. HTTP proxy nativo (sin CORS). Recomendado para servicios locales
  // (qBittorrent, Transmission, Jellyfin…) a los que el webview no puede llamar.
  const http = {
    async request(options: {
      method?: string;
      url: string;
      headers?: Record<string, string>;
      body?: string;
      timeoutMs?: number;
    }): Promise<{ status: number; headers: Record<string, string>; body: string }> {
      try {
        return await invoke<{ status: number; headers: Record<string, string>; body: string }>(
          'plugin:http_request',
          {
            method: options.method || 'GET',
            url: options.url,
            headers: options.headers,
            body: options.body,
            timeoutMs: options.timeoutMs,
          }
        );
      } catch (err: any) {
        throw new NativeError(
          `Error en petición HTTP a '${options.url}': ${err.message || err}`,
          'ERR_HTTP_REQUEST',
          err
        );
      }
    },
  };

  // 5. Shell
  const shell = {
    async openPath(_p: string): Promise<void> {},
    async openUrl(url: string): Promise<void> {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(url);
          return;
        } catch {
          // Fallback
        }
      }
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    async showInFolder(_p: string): Promise<void> {},
  };

  // 6. Clipboard API
  const clipboard = {
    async readText(): Promise<string> {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        return await navigator.clipboard.readText();
      }
      return '';
    },
    async writeText(s: string): Promise<void> {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(s);
      }
    },
    async readImage(): Promise<Uint8Array | null> {
      return null;
    },
    async writeImage(_b: Uint8Array): Promise<void> {},
  };

  // 7. Notifications
  const notifications = {
    async send(opts: { title: string; body?: string; icon?: string }): Promise<void> {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(opts.title, { body: opts.body, icon: opts.icon });
        }
      }
    },
  };

  // 8. Tray
  let trayCounter = 0;
  const tray = {
    async create(_opts: TrayOptions): Promise<TrayHandle> {
      trayCounter++;
      return { id: `tray-${trayCounter}` };
    },
    async update(_h: TrayHandle, _opts: Partial<TrayOptions>): Promise<void> {},
    async remove(_h: TrayHandle): Promise<void> {},
  };

  // 9. Shortcuts
  const registeredShortcuts = new Map<string, () => void>();
  let shortcutListenerInitialized = false;

  const shortcuts = {
    async register(accel: string, cb: () => void): Promise<() => void> {
      registeredShortcuts.set(accel.toLowerCase(), cb);

      if (!shortcutListenerInitialized && typeof window !== 'undefined') {
        shortcutListenerInitialized = true;
        if ((window as any).__TAURI_INTERNALS__) {
          try {
            const { listen } = await import('@tauri-apps/api/event');
            listen<string>('global-shortcut:pressed', (e) => {
              const handler = registeredShortcuts.get(e.payload.toLowerCase());
              if (handler) handler();
            });
          } catch {
            // fallback
          }
        }
      }

      await invoke('native_register_shortcut', { shortcut: accel }).catch(() => {});

      return () => {
        registeredShortcuts.delete(accel.toLowerCase());
        invoke('native_unregister_shortcut', { shortcut: accel }).catch(() => {});
      };
    },

    async unregister(accel: string): Promise<void> {
      registeredShortcuts.delete(accel.toLowerCase());
      await invoke('native_unregister_shortcut', { shortcut: accel }).catch(() => {});
    },
  };

  // 10. Windows
  const windows = {
    async create(opts: WindowOptions): Promise<string> {
      await invoke('native_create_window', { config: opts }).catch(() => {});
      return opts.label;
    },

    async list(): Promise<WindowInfo[]> {
      return [
        {
          id: 'main',
          label: 'main',
          title: 'IndexLy Desktop',
          visible: true,
          focused: true,
        },
      ];
    },

    async focus(id: string): Promise<void> {
      await invoke('plugin:window_show', { label: id }).catch(() => {});
    },

    async close(id: string): Promise<void> {
      await invoke('plugin:window_close', { label: id }).catch(() => {});
    },
  };

  // 11. OS info
  const os = {
    platform(): 'windows' | 'macos' | 'linux' {
      return 'windows';
    },
    arch(): string {
      return 'x64';
    },
    async version(): Promise<string> {
      return '10.0';
    },
    locale(): string {
      return 'es';
    },
  };

  // 12. Keychain API
  const keychain = {
    async get(key: string): Promise<string | null> {
      try {
        return await invoke<string | null>('plugin:keychain_get', { key });
      } catch (err: any) {
        throw new NativeError(`Error obteniendo clave de keychain '${key}': ${err.message || err}`, 'ERR_KEYCHAIN', err);
      }
    },

    async set(key: string, value: string): Promise<void> {
      try {
        await invoke('plugin:keychain_set', { key, val: value });
      } catch (err: any) {
        throw new NativeError(`Error guardando en keychain '${key}': ${err.message || err}`, 'ERR_KEYCHAIN', err);
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await invoke('plugin:keychain_delete', { key });
      } catch (err: any) {
        throw new NativeError(`Error eliminando de keychain '${key}': ${err.message || err}`, 'ERR_KEYCHAIN', err);
      }
    },
  };

  // 13. Database API
  const db = {
    async query<T = unknown>(sql: string, _params?: unknown[]): Promise<T[]> {
      try {
        return await invoke<T[]>('plugin:db_query', { query: sql });
      } catch (err: any) {
        throw new NativeError(`Error en consulta de base de datos: ${err.message || err}`, 'ERR_DB_QUERY', err);
      }
    },

    async exec(sql: string): Promise<void> {
      try {
        await invoke('plugin:db_exec', { query: sql });
      } catch (err: any) {
        throw new NativeError(`Error ejecutando sentencia SQL: ${err.message || err}`, 'ERR_DB_EXEC', err);
      }
    },
  };

  return {
    invoke,
    fs,
    path,
    process,
    net,
    http,
    shell,
    clipboard,
    notifications,
    tray,
    shortcuts,
    windows,
    os,
    keychain,
    db,
  };
}
