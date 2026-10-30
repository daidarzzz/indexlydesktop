/**
 * @file src/plugins/api/EventsApi.ts
 * @description Bus de eventos desacoplado y fuertemente tipado para IndexLy Desktop (v1).
 */

import { EventRef, EventsApi } from '../types';

interface InternalListener {
  id: string;
  callback: (data: any) => void;
  pluginId?: string;
}

/**
 * Implementación del bus de eventos central `app.events`.
 * Gestiona suscripciones tipadas, referencias EventRef y aislamiento de fallos entre listeners.
 */
export class HostEventsApi implements EventsApi {
  /** Mapa privado de eventos y sus suscriptores */
  private _listeners: Map<string, InternalListener[]> = new Map();
  /** Contador autoincremental para IDs de suscripción */
  private _nextRefId: number = 1;

  /**
   * Suscribe un callback a un evento específico.
   * @param event Nombre del evento (puede ser estándar del host o namespaced `pluginId:evento`)
   * @param callback Función receptora de datos
   * @param pluginId Identificador opcional del plugin suscriptor
   * @returns Referencia inmutable EventRef para cancelación
   */
  public on(event: string, callback: (data: any) => void, pluginId?: string): EventRef {
    const refId = `evt_ref_${this._nextRefId++}_${Date.now()}`;
    const entry: InternalListener = { id: refId, callback, pluginId };

    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event)!.push(entry);

    return {
      id: refId,
      event,
    };
  }

  /**
   * Cancela una suscripción mediante su EventRef.
   * @param ref Referencia devuelta por `on()`
   */
  public off(ref: EventRef): void {
    if (!ref || !ref.id || !ref.event) return;

    const list = this._listeners.get(ref.event);
    if (!list) return;

    const filtered = list.filter((l) => l.id !== ref.id);
    if (filtered.length === 0) {
      this._listeners.delete(ref.event);
    } else {
      this._listeners.set(ref.event, filtered);
    }
  }

  /**
   * Emite un evento con datos asociados a todos sus suscriptores activos.
   * Cada callback se ejecuta en un bloque protegido; los errores de un suscriptor no impiden
   * que los demás reciban la notificación.
   * @param event Nombre del evento
   * @param payload Datos opcionales adjuntos
   */
  public emit(event: string, payload?: unknown): void {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return;

    // Clonar lista para evitar problemas si un listener se desuscribe durante la iteración
    const snapshot = [...list];
    for (const listener of snapshot) {
      try {
        listener.callback(payload);
      } catch (err) {
        console.error(`[EventsApi] Error no capturado en listener para '${event}':`, err);
      }
    }
  }

  /**
   * Purga todas las suscripciones asociadas a un plugin específico al descargarse.
   * @param pluginId Identificador del plugin
   */
  public purgePlugin(pluginId: string): void {
    for (const [event, list] of this._listeners.entries()) {
      const remaining = list.filter((l) => l.pluginId !== pluginId);
      if (remaining.length === 0) {
        this._listeners.delete(event);
      } else {
        this._listeners.set(event, remaining);
      }
    }
  }

  /**
   * Limpia la totalidad de listeners (usado en tests y resets de aplicación).
   */
  public clear(): void {
    this._listeners.clear();
  }
}
