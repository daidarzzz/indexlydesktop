/**
 * @file src/plugins/api/LibraryApi.ts
 * @description Implementación del módulo `app.library` para gestión de fuentes de datos e items.
 */

import { AddSourceInput, EventRef, LibraryApi, LibraryQuery, Source, UnifiedItem } from '../types';
import { HostEventsApi } from './EventsApi';

/**
 * Implementación de la API de biblioteca del host (`app.library`).
 * Interactúa con la base de datos de fuentes de Tauri y emite eventos reactivos tipados.
 */
export class HostLibraryApi implements LibraryApi {
  private _events: HostEventsApi;
  private _cachedSources: Source[] = [];

  constructor(events: HostEventsApi) {
    this._events = events;
  }

  /**
   * Sincroniza la caché local de fuentes mantenida por el host.
   */
  public setSourcesCache(sources: Source[]): void {
    this._cachedSources = [...sources];
  }

  /**
   * Obtiene la lista completa de fuentes configuradas en el host.
   */
  public async getSources(): Promise<Source[]> {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const sources = await invoke<Source[]>('get_sources');
        this._cachedSources = sources;
        return sources;
      } catch (err) {
        console.error('[LibraryApi] Error invocando get_sources:', err);
      }
    }
    return [...this._cachedSources];
  }

  /**
   * Obtiene una fuente específica por su identificador único.
   * @param id Identificador UUID de la fuente
   */
  public async getSource(id: string): Promise<Source | null> {
    const list = await this.getSources();
    return list.find((s) => s.id === id) || null;
  }

  /**
   * Añade una nueva fuente de datos procesando su contenido.
   * Emite el evento `source:added` y `sources:changed`.
   * @param input Parámetros de la nueva fuente
   */
  public async addSource(input: AddSourceInput): Promise<Source> {
    if (!input || !input.name) {
      throw new Error('[LibraryApi] addSource requiere un nombre de fuente válido');
    }

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

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const sources = await invoke<Source[]>('import_file', {
        name: input.name,
        content,
        mapping,
      });

      const created = sources.find((s) => s.name === input.name) || sources[0];
      if (created) {
        this._cachedSources.push(created);
        this._events.emit('library:source:added', created);
        this._events.emit('source:added', created);
        this._events.emit('library:sources:changed', this._cachedSources);
        this._events.emit('sources:changed', this._cachedSources);
        return created;
      }
    }

    // Fallback para testing en memoria
    const fallbackSource: Source = {
      id: `src_${Date.now()}`,
      name: input.name,
      active: true,
      count: 0,
      mapping,
    };
    this._cachedSources.push(fallbackSource);
    this._events.emit('library:source:added', fallbackSource);
    this._events.emit('source:added', fallbackSource);
    this._events.emit('library:sources:changed', this._cachedSources);
    this._events.emit('sources:changed', this._cachedSources);
    return fallbackSource;
  }

  /**
   * Actualiza el estado o metadatos de una fuente existente.
   * @param id Identificador de la fuente
   * @param patch Modificaciones a aplicar
   */
  public async updateSource(id: string, patch: Partial<Source>): Promise<Source> {
    const existing = await this.getSource(id);
    if (!existing) {
      throw new Error(`[LibraryApi] No se encontró la fuente con id '${id}'`);
    }

    const updated: Source = {
      ...existing,
      ...patch,
      id, // Preservar id inmutable
    };

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      if (patch.active !== undefined && patch.active !== existing.active) {
        await invoke('toggle_source', { id, active: patch.active });
      }
      if (patch.mapping || patch.flags || patch.name) {
        await invoke('update_source_mapping', {
          id,
          name: updated.name,
          mapping: updated.mapping,
          flags: updated.flags,
        });
      }
    }

    const idx = this._cachedSources.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this._cachedSources[idx] = updated;
    }

    this._events.emit('library:source:updated', updated);
    this._events.emit('source:updated', updated);
    this._events.emit('library:sources:changed', this._cachedSources);
    this._events.emit('sources:changed', this._cachedSources);
    return updated;
  }

  /**
   * Elimina una fuente y todos sus items asociados en SQLite.
   * @param id Identificador de la fuente a eliminar
   */
  public async removeSource(id: string): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('delete_source', { id });
    }

    this._cachedSources = this._cachedSources.filter((s) => s.id !== id);
    this._events.emit('library:source:removed', { id });
    this._events.emit('source:removed', { id });
    this._events.emit('library:sources:changed', this._cachedSources);
    this._events.emit('sources:changed', this._cachedSources);
  }

  /**
   * Recupera items de una fuente o biblioteca.
   * @param query Filtros de consulta
   */
  public async getItems(query: LibraryQuery = {}): Promise<UnifiedItem[]> {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      if (query.sourceId) {
        return await invoke<UnifiedItem[]>('get_source_items', { id: query.sourceId });
      }
      const res = await invoke<{ items: UnifiedItem[] }>('search_items', {
        query: '',
        filterLink: query.filterLink || null,
        sortBy: 'relevance',
        limit: query.limit || 500,
        offset: query.offset || 0,
      });
      return res.items || [];
    }
    return [];
  }

  /**
   * Recupera un item específico por su identificador.
   * @param id Identificador del item
   */
  public async getItem(id: string): Promise<UnifiedItem | null> {
    const parts = id.split(':');
    const sourceId = parts[0];
    if (!sourceId) return null;

    const items = await this.getItems({ sourceId });
    return items.find((it) => it.id === id) || null;
  }

  /**
   * Suscribe a eventos de la biblioteca.
   */
  public on(
    event: 'source:added' | 'source:updated' | 'source:removed' | 'items:changed',
    cb: (payload: any) => void
  ): EventRef {
    return this._events.on(`library:${event}`, cb);
  }
}
