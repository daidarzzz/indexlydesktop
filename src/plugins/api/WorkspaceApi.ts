/**
 * @file src/plugins/api/WorkspaceApi.ts
 * @description Implementación del módulo `app.workspace` para gestión de hojas, vistas, layout y ventanas nativas.
 */

import { EventRef, View, WindowInfo, WorkspaceApi, WorkspaceLeaf } from '../types';
import { HostEventsApi } from './EventsApi';

/**
 * Implementación concreta de una hoja de trabajo (`WorkspaceLeaf`).
 */
export class HostWorkspaceLeaf implements WorkspaceLeaf {
  public readonly id: string;
  public view: View | null = null;
  private _detached = false;
  private _onDetach?: (leaf: HostWorkspaceLeaf) => void;

  constructor(id: string, onDetach?: (leaf: HostWorkspaceLeaf) => void) {
    this.id = id;
    this._onDetach = onDetach;
  }

  public async open(view: View): Promise<void> {
    if (this._detached) return;
    if (this.view) {
      await this.view.onClose();
    }
    this.view = view;
    await view.onOpen();
  }

  public detach(): void {
    if (this._detached) return;
    this._detached = true;
    if (this.view) {
      this.view.onClose().catch(() => {});
      this.view.containerEl.remove();
      this.view = null;
    }
    if (this._onDetach) {
      this._onDetach(this);
    }
  }
}

export type ViewFactory = (leaf: WorkspaceLeaf) => View;

/**
 * Implementación de `app.workspace`.
 */
export class HostWorkspaceApi implements WorkspaceApi {
  private _events: HostEventsApi;
  private _leaves: HostWorkspaceLeaf[] = [];
  private _viewFactories: Map<string, ViewFactory> = new Map();
  private _layoutReady = false;
  private _layoutReadyCallbacks: Array<() => void> = [];
  private _nextLeafId = 1;

  constructor(events: HostEventsApi) {
    this._events = events;
  }

  /**
   * Registra un constructor de vistas para un tipo de hoja.
   */
  public registerViewFactory(type: string, factory: ViewFactory): void {
    this._viewFactories.set(type, factory);
  }

  /**
   * Desregistra un tipo de vista.
   */
  public unregisterViewFactory(type: string): void {
    this._viewFactories.delete(type);
  }

  /**
   * Notifica que el layout principal de la aplicación está completamente montado.
   */
  public markLayoutReady(): void {
    this._layoutReady = true;
    while (this._layoutReadyCallbacks.length > 0) {
      const cb = this._layoutReadyCallbacks.shift();
      if (cb) {
        try {
          cb();
        } catch (err) {
          console.error('[WorkspaceApi] Error en callback onLayoutReady:', err);
        }
      }
    }
  }

  public onLayoutReady(callback: () => void): void {
    if (this._layoutReady) {
      callback();
    } else {
      this._layoutReadyCallbacks.push(callback);
    }
  }

  public getActiveWindow(): WindowInfo {
    return {
      id: 'main',
      label: 'main',
      title: 'IndexLy Desktop',
      visible: true,
      focused: true,
    };
  }

  public getWindows(): WindowInfo[] {
    return [this.getActiveWindow()];
  }

  public getLeaves(): WorkspaceLeaf[] {
    return [...this._leaves];
  }

  public getLeaf(type?: string): WorkspaceLeaf {
    // Si se especifica un tipo y existe una fábrica registrada, instanciarla
    const leafId = `leaf_${this._nextLeafId++}_${Date.now()}`;
    const leaf = new HostWorkspaceLeaf(leafId, (l) => {
      this._leaves = this._leaves.filter((item) => item !== l);
      this._events.emit('workspace:layout-change', {});
    });

    if (type && this._viewFactories.has(type)) {
      const factory = this._viewFactories.get(type)!;
      const view = factory(leaf);
      leaf.open(view).catch((err) => {
        console.error(`[WorkspaceApi] Error abriendo vista de tipo '${type}':`, err);
      });
    }

    this._leaves.push(leaf);
    this._events.emit('workspace:layout-change', {});
    return leaf;
  }

  public revealLeaf(leaf: WorkspaceLeaf): void {
    if (leaf.view?.containerEl) {
      leaf.view.containerEl.scrollIntoView({ behavior: 'smooth' });
    }
  }

  public detachLeavesOfType(type: string): void {
    for (const leaf of [...this._leaves]) {
      if (leaf.view && leaf.view.getViewType() === type) {
        leaf.detach();
      }
    }
  }

  public async openSpotlight(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('toggle_spotlight');
    } else {
      console.log('[WorkspaceApi] openSpotlight invocado en entorno de pruebas');
    }
    this._events.emit('workspace:spotlight:open', {});
  }

  public on(event: 'layout-change' | 'window:open' | 'window:close', cb: (data: any) => void): EventRef {
    return this._events.on(`workspace:${event}`, cb);
  }
}
