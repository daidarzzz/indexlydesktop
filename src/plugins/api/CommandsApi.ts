/**
 * @file src/plugins/api/CommandsApi.ts
 * @description Registro y despacho de comandos globales de la paleta y menú contextual.
 */

import { Command, CommandsApi, ContextMenuItem, EventRef } from '../types';

/**
 * Implementación de `app.commands`.
 */
export class HostCommandsApi implements CommandsApi {
  /** Mapa privado de comandos indexados por ID */
  private _commands: Map<string, Command> = new Map();
  /** Elementos del menú contextual registrados dinámicamente */
  private _contextMenuItems: Map<string, ContextMenuItem> = new Map();
  private _nextMenuId: number = 1;

  /**
   * Registra un comando en la paleta global.
   * @param command Definición del comando
   * @returns El comando registrado
   */
  public addCommand(command: Command): Command {
    if (!command || !command.id || !command.name) {
      throw new Error('[CommandsApi] addCommand requiere un objeto Command con id y name válidos');
    }
    this._commands.set(command.id, command);
    return command;
  }

  /**
   * Elimina un comando registrado.
   * @param id Identificador único del comando
   */
  public removeCommand(id: string): void {
    this._commands.delete(id);
  }

  /**
   * Ejecuta un comando registrado por su identificador.
   * Valida disponibilidad mediante `checkCallback` si existe.
   * @param id Identificador del comando
   * @param args Argumentos opcionales pasados al comando
   * @returns `true` si el comando fue ejecutado con éxito; `false` en caso contrario
   */
  public async executeCommand(id: string, ...args: unknown[]): Promise<boolean> {
    const cmd = this._commands.get(id);
    if (!cmd) return false;

    // Si tiene checkCallback, comprobar disponibilidad
    if (typeof cmd.checkCallback === 'function') {
      const isAvailable = cmd.checkCallback(true);
      if (isAvailable === false) {
        return false;
      }
      try {
        cmd.checkCallback(false);
        return true;
      } catch (err) {
        console.error(`[CommandsApi] Error ejecutando checkCallback de comando '${id}':`, err);
        return false;
      }
    }

    // Callback estándar
    if (typeof cmd.callback === 'function') {
      try {
        const res = (cmd.callback as Function)(...args);
        if (res instanceof Promise) await res;
        return true;
      } catch (err) {
        console.error(`[CommandsApi] Error ejecutando comando '${id}':`, err);
        return false;
      }
    }

    return false;
  }

  /**
   * Devuelve la lista completa de comandos registrados actualmente.
   */
  public listCommands(): Command[] {
    return Array.from(this._commands.values());
  }

  /**
   * Añade una opción al menú contextual.
   * @param item Configuración del item
   */
  public addContextMenuItem(item: ContextMenuItem): EventRef {
    const id = item.id || `ctx_menu_${this._nextMenuId++}`;
    this._contextMenuItems.set(id, { ...item, id });

    return {
      id,
      event: 'context-menu',
    };
  }

  /**
   * Remueve una opción del menú contextual por su ID.
   */
  public removeContextMenuItem(id: string): void {
    this._contextMenuItems.delete(id);
  }

  /**
   * Obtiene todos los items del menú contextual activos.
   */
  public getContextMenuItems(): ContextMenuItem[] {
    return Array.from(this._contextMenuItems.values());
  }

  /**
   * Limpia todos los comandos y menús (para tests o reseteos).
   */
  public clear(): void {
    this._commands.clear();
    this._contextMenuItems.clear();
  }
}
