/**
 * @file src/plugins/api/ImporterApi.ts
 * @description Implementación del módulo `app.importer` para ampliación de pipelines de formatos e importación.
 */

import { CustomImporter, EventRef, ImporterApi, ImportProgress, Source } from '../types';
import { HostEventsApi } from './EventsApi';

/**
 * Implementación de `app.importer`.
 */
export class HostImporterApi implements ImporterApi {
  private _events: HostEventsApi;
  private _importers: Map<string, CustomImporter> = new Map();

  constructor(events: HostEventsApi) {
    this._events = events;
  }

  /**
   * Registra un importador personalizado (p. ej. para formatos `.epub`, `.m3u8`, `.xml`).
   */
  public registerImporter(importer: CustomImporter): EventRef {
    if (!importer || !importer.id) {
      throw new Error('[ImporterApi] registerImporter requiere un importador con id válido');
    }
    this._importers.set(importer.id, importer);

    return {
      id: importer.id,
      event: 'importer:registered',
    };
  }

  /**
   * Desregistra un importador por su ID.
   */
  public unregisterImporter(id: string): void {
    this._importers.delete(id);
  }

  /**
   * Procesa la importación de un archivo a través de la cadena de importadores registrados o el motor base.
   */
  public async importFile(pathOrContent: string, opts?: { filename?: string; mapping?: any }): Promise<Source[]> {
    const filename = opts?.filename || (pathOrContent.length < 255 ? pathOrContent : 'import.json');
    const content = pathOrContent;
    const prefix = content.substring(0, 500);

    // 1. Comprobar si algún importador registrado puede manejarlo
    for (const importer of this._importers.values()) {
      try {
        if (importer.canHandle(filename, prefix)) {
          this._events.emit('import:progress', {
            current: 50,
            total: 100,
            stage: `Procesando con ${importer.name}`,
          });
          const sources = await importer.parse(content, filename);
          this._events.emit('import:progress', {
            current: 100,
            total: 100,
            stage: 'Completado',
          });
          return sources;
        }
      } catch (err) {
        console.error(`[ImporterApi] Error en importador '${importer.id}':`, err);
      }
    }

    // 2. Fallback a import_file nativo de Tauri
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<Source[]>('import_file', {
        name: filename,
        content,
        mapping: opts?.mapping,
      });
    }

    return [];
  }

  public on(event: 'import:progress', cb: (p: ImportProgress) => void): EventRef {
    return this._events.on(`importer:${event}`, cb as (data: any) => void);
  }
}
