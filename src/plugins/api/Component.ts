/**
 * @file src/plugins/api/Component.ts
 * @description Clase base Component para gestión jerárquica y determinista de recursos reversibles.
 */

import { EventRef } from '../types';

/**
 * Clase base que encapsula el ciclo de vida de carga, descarga y registro de recursos limpiables.
 * Todas las funciones de limpieza registradas se ejecutan en estricto orden LIFO (Last-In-First-Out).
 */
export class Component {
  protected _loaded: boolean = false;
  /** Pila LIFO de funciones de descarte */
  private _disposables: Array<() => unknown> = [];

  /**
   * Indica si el componente se encuentra actualmente cargado y activo.
   */
  public get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Hook de inicialización del componente.
   */
  public async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
  }

  /**
   * Hook de descarga. Ejecuta todas las funciones de descarte en orden inverso al registro.
   * Es estrictamente idempotente.
   */
  public async unload(): Promise<void> {
    if (!this._loaded && this._disposables.length === 0) return;
    this._loaded = false;

    // Ejecutar en orden LIFO estricto
    while (this._disposables.length > 0) {
      const teardown = this._disposables.pop();
      if (typeof teardown === 'function') {
        try {
          await teardown();
        } catch (err) {
          console.error('[Component] Error ejecutando función de limpieza:', err);
        }
      }
    }
  }

  /**
   * Registra una función de descarte personalizada que se ejecutará al descargar el componente.
   * @param teardownCallback Callback de descarte
   */
  public register(teardownCallback: () => unknown): void {
    if (typeof teardownCallback === 'function') {
      this._disposables.push(teardownCallback);
    }
  }

  /**
   * Registra una suscripción a eventos para su cancelación automática al descargar.
   * @param ref Referencia devuelta por `app.events.on`
   */
  public registerEvent(ref: EventRef): void {
    if (!ref || !ref.id) return;
    this.register(() => {
      // El host se encarga de resolver la cancelación mediante app.events.off
      if ((this as any).app && (this as any).app.events) {
        (this as any).app.events.off(ref);
      }
    });
  }

  /**
   * Registra un listener de eventos del DOM en un elemento, Document o Window.
   * El listener se desregistra de forma automática en `unload()`.
   * @param element Objetivo del evento
   * @param type Nombre del evento estándar
   * @param callback Manejador de evento
   * @param options Opciones de addEventListener
   */
  public registerDomEvent<K extends keyof HTMLElementEventMap>(
    element: HTMLElement | Window | Document,
    type: K,
    callback: (ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!element || typeof element.addEventListener !== 'function') return;

    element.addEventListener(type, callback as EventListener, options);
    this.register(() => {
      element.removeEventListener(type, callback as EventListener, options);
    });
  }

  /**
   * Registra un identificador de intervalo (`setInterval`) para su cancelación automática.
   * @param id Identificador devuelto por window.setInterval
   * @returns El mismo identificador numérico
   */
  public registerInterval(id: number): number {
    this.register(() => {
      window.clearInterval(id);
    });
    return id;
  }

  /**
   * Registra un identificador de temporizador (`setTimeout`) para su cancelación automática.
   * @param id Identificador devuelto por window.setTimeout
   * @returns El mismo identificador numérico
   */
  public registerTimeout(id: number): number {
    this.register(() => {
      window.clearTimeout(id);
    });
    return id;
  }
}
