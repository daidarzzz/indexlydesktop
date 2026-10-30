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
    button.innerHTML = `<span class="indexly-icon icon-${icon}"></span>`;

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
