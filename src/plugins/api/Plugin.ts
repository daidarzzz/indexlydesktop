/**
 * @file src/plugins/api/Plugin.ts
 * @description Clase abstracta base Plugin para todas las extensiones de IndexLy Desktop (v1).
 */

import { Component } from './Component';
import { App, PluginManifest, Command, WorkspaceLeaf, View } from '../types';

/**
 * Clase abstracta que deben extender todos los plugins de IndexLy Desktop.
 * Proporciona métodos declarativos reversibles y acceso al grafo del host `app`.
 */
export abstract class Plugin extends Component {
  /** Referencia inmutable al grafo de la API del host */
  public readonly app: App;
  /** Metadatos del manifiesto del plugin */
  public readonly manifest: PluginManifest;
  /** Token de generación asignado por el host para invalidación de llamadas tardías */
  public _generationId: number = 0;

  constructor(app: App, manifest: PluginManifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  /**
   * Hook de ciclo de vida ejecutado tras la inicialización del bundle.
   * Debe resolverse en menos de 10 segundos.
   */
  abstract onload(): void | Promise<void>;

  /**
   * Hook de ciclo de vida ejecutado durante la descarga o desactivación.
   * Debe resolverse en menos de 5 segundos y ser estrictamente idempotente.
   */
  async onunload(): Promise<void> {}

  /**
   * Registra un comando en la paleta de comandos de IndexLy.
   * Se elimina automáticamente de la paleta cuando el plugin se descarga.
   * @param cmd Definición del comando
   * @returns El comando registrado
   */
  public addCommand(cmd: Command): Command {
    const registered = this.app.commands.addCommand(cmd);
    this.register(() => {
      this.app.commands.removeCommand(cmd.id);
    });
    return registered;
  }

  /**
   * Añade un icono interactivo a la barra lateral (Ribbon) de la aplicación.
   * El elemento HTML se remueve automáticamente del DOM al descargar el plugin.
   * @param icon Identificador del icono
   * @param title Texto del tooltip
   * @param callback Manejador de clic
   * @returns El elemento HTML del botón insertado
   */
  public addRibbonIcon(icon: string, title: string, callback: (ev: MouseEvent) => unknown): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'indexly-ribbon-item';
    button.setAttribute('data-plugin-id', this.manifest.id);
    button.setAttribute('title', title);
    button.setAttribute('aria-label', title);

    const svgIcons: Record<string, string> = {
      'edit-3': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
      'file-text': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      'search': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
      'settings': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
    };

    button.innerHTML = svgIcons[icon] || `<span class="indexly-icon icon-${icon}">📌</span>`;

    const clickListener = (ev: MouseEvent) => {
      try {
        callback(ev);
      } catch (err) {
        console.error(`[Plugin:${this.manifest.id}] Error en ribbon icon click:`, err);
      }
    };
    button.addEventListener('click', clickListener);

    // Insertar en contenedor ribbon del host si existe, o en document.body
    const ribbonContainer = document.querySelector('.indexly-ribbon-bar') || document.body;
    ribbonContainer.appendChild(button);

    this.register(() => {
      button.removeEventListener('click', clickListener);
      button.remove();
    });

    return button;
  }

  /**
   * Añade un contenedor en la barra de estado inferior (Status Bar).
   * El elemento se elimina automáticamente del DOM al descargar.
   * @returns El elemento HTML del contenedor en la barra de estado
   */
  public addStatusBarItem(): HTMLElement {
    const item = document.createElement('div');
    item.className = 'indexly-status-bar-item';
    item.setAttribute('data-plugin-id', this.manifest.id);

    const statusBarContainer = document.querySelector('.indexly-status-bar') || document.body;
    statusBarContainer.appendChild(item);

    this.register(() => {
      item.remove();
    });

    return item;
  }

  /**
   * Registra una pestaña de configuración exclusiva para este plugin en la ventana de Ajustes.
   * @param tab Instancia de PluginSettingTab
   */
  public addSettingTab(tab: any): void {
    if (this.app.settings && typeof this.app.settings.registerTab === 'function') {
      this.app.settings.registerTab(tab);
      this.register(() => {
        // Limpieza de pestaña si la API de settings lo soporta
      });
    }
  }

  /**
   * Registra un nuevo tipo de vista acoplable para su uso en WorkspaceLeaves.
   * Al descargarse el plugin, desregistra el tipo y cierra todas las hojas activas asociadas.
   * @param type Identificador único del tipo de vista
   * @param _factory Función fábrica que construye la vista
   */
  public registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void {
    const ws = this.app.workspace as any;
    if (typeof ws?.registerViewFactory === 'function') {
      ws.registerViewFactory(type, factory);
    } else if (typeof ws?.registerViewType === 'function') {
      ws.registerViewType(type, factory);
    } else if (typeof ws?.registerView === 'function') {
      ws.registerView(type, factory);
    }

    this.register(() => {
      if (typeof ws?.unregisterViewFactory === 'function') {
        ws.unregisterViewFactory(type);
      }
      if (this.app.workspace && typeof this.app.workspace.detachLeavesOfType === 'function') {
        this.app.workspace.detachLeavesOfType(type);
      }
    });
  }

  /**
   * Carga los ajustes o datos persistentes del plugin desde `data.json`.
   * @returns Datos deserializados o null si no existen
   */
  public async loadData<T = unknown>(): Promise<T | null> {
    return await this.app.storage.readJson<T>('data.json');
  }

  /**
   * Guarda de forma atómica los ajustes o datos del plugin en `data.json`.
   * @param data Objeto serializable a JSON
   */
  public async saveData(data: unknown): Promise<void> {
    await this.app.storage.writeJson('data.json', data);
  }
}
