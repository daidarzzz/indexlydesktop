/**
 * @file src/plugins/api/SearchApi.ts
 * @description Implementación del módulo `app.search` para búsquedas FTS5, streaming asíncrono y proveedores secundarios.
 */

import {
  EventRef,
  SearchApi,
  SearchContext,
  SearchHit,
  SearchOptions,
  SearchProvider,
  SearchResults,
} from '../types';
import { HostEventsApi } from './EventsApi';

/**
 * Implementación de la API de búsqueda del host (`app.search`).
 * Ofrece soporte para consultas paginadas, streaming con AbortSignal y decoración mediante interceptores.
 */
export class HostSearchApi implements SearchApi {
  private _events: HostEventsApi;
  private _providers: Map<string, SearchProvider> = new Map();

  constructor(events: HostEventsApi) {
    this._events = events;
  }

  /**
   * Ejecuta una búsqueda de texto completo con soporte de AbortSignal e interceptores.
   * @param q Término de búsqueda
   * @param opts Opciones de paginación, filtros y señal de cancelación
   */
  public async query(q: string, opts: SearchOptions = {}): Promise<SearchResults> {
    // 1. Comprobar si la petición ya fue abortada antes de iniciar
    if (opts.signal?.aborted) {
      throw new DOMException('La búsqueda fue cancelada', 'AbortError');
    }

    const context: SearchContext = {
      query: q || '',
      filterLink: opts.filterLink || null,
      sortBy: opts.sortBy || 'relevance',
      limit: opts.limit ?? 30,
      offset: opts.offset ?? 0,
    };

    // 2. Interceptor query:before para permitir a plugins modificar o decorar el contexto
    this._events.emit('search:query:before', context);

    // 3. Comprobar proveedores de búsqueda registrados
    if (this._providers.size > 0) {
      for (const provider of this._providers.values()) {
        if (opts.signal?.aborted) {
          throw new DOMException('La búsqueda fue cancelada', 'AbortError');
        }
        try {
          const res = await provider.search(context.query, opts);
          context.results = res;
          this._events.emit('search:query:after', context);
          return res;
        } catch {
          // Continuar con siguiente proveedor o FTS5 por defecto
        }
      }
    }

    // 4. Invocación a Tauri IPC SQLite FTS5
    let results: SearchResults = {
      items: [],
      total: 0,
      active_sources_count: 0,
      total_items_count: 0,
      took_ms: 0,
    };

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      if (opts.signal?.aborted) {
        throw new DOMException('La búsqueda fue cancelada', 'AbortError');
      }

      const { invoke } = await import('@tauri-apps/api/core');
      results = await invoke<SearchResults>('search_items', {
        query: context.query,
        filterLink: context.filterLink,
        sortBy: context.sortBy,
        limit: context.limit,
        offset: context.offset,
      });
    }

    // Comprobar señal tras la invocación
    if (opts.signal?.aborted) {
      throw new DOMException('La búsqueda fue cancelada', 'AbortError');
    }

    context.results = results;

    // 5. Interceptor query:after para decorar resultados
    this._events.emit('search:query:after', context);

    return context.results || results;
  }

  /**
   * Generador asíncrono para streaming de resultados con verificación continua de AbortSignal.
   * Permite procesar grandes volúmenes de datos con detención inmediata si el usuario reescribe la consulta.
   */
  public async *queryStream(q: string, opts: SearchOptions = {}): AsyncIterable<SearchHit> {
    const res = await this.query(q, opts);

    for (let i = 0; i < res.items.length; i++) {
      // Verificación cooperativa de cancelación en cada iteración
      if (opts.signal?.aborted) {
        break;
      }

      const item = res.items[i]!;
      yield {
        item,
        score: 1.0 - i * 0.01,
        matchField: 'title',
      };
    }
  }

  /**
   * Registra un proveedor secundario de búsqueda.
   */
  public registerProvider(provider: SearchProvider): void {
    if (!provider || !provider.id) return;
    this._providers.set(provider.id, provider);
  }

  /**
   * Desregistra un proveedor secundario.
   */
  public unregisterProvider(id: string): void {
    this._providers.delete(id);
  }

  /**
   * Fuerza el reindexado de las tablas virtuales FTS5 en la base de datos.
   */
  public async reindex(sourceId?: string): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reindex_fts', { sourceId: sourceId || null });
    }
    this._events.emit('search:reindexed', { sourceId });
  }

  /**
   * Suscribe a interceptores de búsqueda.
   */
  public on(event: 'query:before' | 'query:after', cb: (ctx: SearchContext) => void): EventRef {
    return this._events.on(`search:${event}`, cb as (data: any) => void);
  }
}
