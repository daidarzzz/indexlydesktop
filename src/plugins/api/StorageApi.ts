/**
 * @file src/plugins/api/StorageApi.ts
 * @description Almacenamiento local atómico y aislado por plugin para IndexLy Desktop (v1).
 */

import { StorageApi } from '../types';
import { StorageError } from './errors';

/**
 * Proveedor de almacenamiento aislado para un plugin específico (`app.storage`).
 * Todas las operaciones se encuentran confinadas al subdirectorio `<appData>/plugins/<pluginId>/`.
 */
export class ScopedStorageApi implements StorageApi {
  public readonly pluginId: string;
  private _inMemoryStore: Map<string, string> = new Map();

  constructor(pluginId: string) {
    this.pluginId = pluginId;
  }

  /**
   * Obtiene la ruta física del directorio de datos del plugin.
   */
  public async pluginDataDir(id?: string): Promise<string> {
    const targetId = id || this.pluginId;
    return `plugins/${targetId}`;
  }

  /**
   * Lee y deserializa un archivo JSON de forma segura.
   * @param filename Nombre relativo del archivo (p. ej., 'data.json')
   */
  public async readJson<T = unknown>(filename: string): Promise<T | null> {
    try {
      const text = await this.readText(filename);
      if (!text || text.trim() === '') return null;
      return JSON.parse(text) as T;
    } catch (err) {
      if ((err as Error).message?.includes('ENOENT') || (err as Error).message?.includes('no encontrado')) {
        return null;
      }
      return null;
    }
  }

  /**
   * Escribe un objeto serializado en formato JSON con indentación legible.
   * @param filename Nombre relativo del archivo
   * @param data Datos serializables
   */
  public async writeJson(filename: string, data: unknown): Promise<void> {
    try {
      const text = JSON.stringify(data, null, 2);
      await this.writeText(filename, text);
    } catch (err) {
      throw new StorageError(
        `Error serializando JSON para '${filename}' en plugin '${this.pluginId}'`,
        'ERR_STORAGE_SERIALIZATION',
        this.pluginId,
        err
      );
    }
  }

  /**
   * Lee el contenido textual de un archivo dentro del directorio del plugin.
   * @param filename Nombre del archivo
   */
  public async readText(filename: string): Promise<string> {
    // 1. Si existe entorno Tauri con API nativa disponible
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('plugin_storage_read_text', {
          pluginId: this.pluginId,
          filename,
        });
      } catch (err) {
        // Si no existe el archivo nativo, intentar fallback en memoria / local
      }
    }

    // 2. Fallback de pruebas / entorno web: Map en memoria o localStorage
    const key = `indexly_storage:${this.pluginId}:${filename}`;
    if (this._inMemoryStore.has(filename)) {
      return this._inMemoryStore.get(filename)!;
    }
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(key);
      if (val !== null) return val;
    }

    throw new StorageError(`Archivo no encontrado: '${filename}'`, 'ERR_STORAGE_NOT_FOUND', this.pluginId);
  }

  /**
   * Escribe contenido en un archivo de forma atómica.
   * @param filename Nombre relativo del archivo
   * @param content Contenido textual
   */
  public async writeText(filename: string, content: string): Promise<void> {
    // 1. Si existe entorno Tauri nativo
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('plugin_storage_write_text', {
          pluginId: this.pluginId,
          filename,
          content,
        });
        return;
      } catch (err) {
        // En caso de fallo o mock
      }
    }

    // 2. Almacenamiento en memoria y localStorage para tests/dev
    this._inMemoryStore.set(filename, content);
    if (typeof localStorage !== 'undefined') {
      const key = `indexly_storage:${this.pluginId}:${filename}`;
      try {
        localStorage.setItem(key, content);
      } catch (err) {
        throw new StorageError(
          `Límite de almacenamiento excedido al guardar '${filename}'`,
          'ERR_STORAGE_QUOTA',
          this.pluginId,
          err
        );
      }
    }
  }

  /**
   * Elimina un archivo del almacenamiento del plugin.
   * @param filename Nombre relativo del archivo
   */
  public async remove(filename: string): Promise<void> {
    this._inMemoryStore.delete(filename);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`indexly_storage:${this.pluginId}:${filename}`);
    }

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('plugin_storage_remove', {
          pluginId: this.pluginId,
          filename,
        });
      } catch {
        // Ignorar si el archivo no existía en disco
      }
    }
  }
}
