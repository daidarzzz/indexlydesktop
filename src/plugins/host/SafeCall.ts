/**
 * @file src/plugins/host/SafeCall.ts
 * @description Envoltorio de aislamiento de fallos, medición de tiempos de CPU y atribución de errores no capturados.
 */

export interface PluginErrorRecord {
  timestamp: number;
  message: string;
  context?: string;
  stack?: string;
}

export type ThresholdExceededCallback = (pluginId: string, errorCount: number) => void;

/**
 * Gestor de aislamiento de fallos y monitor de rendimiento.
 */
export class SafeCallManager {
  /** Pila de contexto de ejecución para atribución síncrona/asíncrona */
  private _contextStack: string[] = [];
  /** Registro de errores por plugin en ventana deslizante */
  private _errorsByPlugin: Map<string, PluginErrorRecord[]> = new Map();
  /** Límite de errores antes de notificar/desactivar (por defecto 10 en 5 minutos) */
  private readonly MAX_ERRORS = 10;
  private readonly WINDOW_MS = 5 * 60 * 1000;
  /** Callback notificado cuando se excede el umbral de fallos */
  private _onThresholdExceeded: ThresholdExceededCallback | null = null;
  /** Limpiador de listeners globales */
  private _globalHandlersInstalled = false;

  constructor() {
    this.installGlobalErrorHandlers();
  }

  /**
   * Configura el callback invocado cuando un plugin supera el límite de 10 errores en 5 minutos.
   */
  public onThresholdExceeded(cb: ThresholdExceededCallback): void {
    this._onThresholdExceeded = cb;
  }

  /**
   * Obtiene el identificador del plugin activo en la cima de la pila de ejecución.
   */
  public getActiveContext(): string | undefined {
    return this._contextStack[this._contextStack.length - 1];
  }

  /**
   * Ejecuta una función síncrona o asíncrona dentro de un contexto protegido y medido.
   * Si la función arroja una excepción, es capturada, atribuida al plugin y no se propaga al host.
   * @param pluginId Identificador del plugin
   * @param fn Función a ejecutar
   * @param contextName Nombre descriptivo de la acción (p. ej. 'command:saludar')
   */
  public async safeCall<T>(
    pluginId: string,
    fn: () => T | Promise<T>,
    contextName: string = 'callback'
  ): Promise<T | undefined> {
    this._contextStack.push(pluginId);
    const start = performance.now();

    try {
      const result = fn();
      if (result instanceof Promise) {
        return await result;
      }
      return result;
    } catch (err) {
      this.recordError(pluginId, err, contextName);
      return undefined;
    } finally {
      const elapsed = performance.now() - start;
      if (elapsed > 250) {
        console.warn(
          `[SafeCall] ADVERTENCIA: El plugin '${pluginId}' retuvo el hilo durante ${elapsed.toFixed(1)}ms en '${contextName}'`
        );
      }
      this._contextStack.pop();
    }
  }

  /**
   * Variante estrictamente síncrona de safeCall.
   */
  public safeCallSync<T>(pluginId: string, fn: () => T, contextName: string = 'callback'): T | undefined {
    this._contextStack.push(pluginId);
    const start = performance.now();

    try {
      return fn();
    } catch (err) {
      this.recordError(pluginId, err, contextName);
      return undefined;
    } finally {
      const elapsed = performance.now() - start;
      if (elapsed > 250) {
        console.warn(
          `[SafeCall] ADVERTENCIA: El plugin '${pluginId}' retuvo el hilo síncrono durante ${elapsed.toFixed(1)}ms en '${contextName}'`
        );
      }
      this._contextStack.pop();
    }
  }

  /**
   * Registra un error atribuido a un plugin y evalúa si superó el umbral.
   */
  public recordError(pluginId: string, error: unknown, context?: string): void {
    const now = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    console.error(`[SafeCall] Excepción aislada en plugin '${pluginId}' (${context || 'unknown'}):`, error);

    if (!this._errorsByPlugin.has(pluginId)) {
      this._errorsByPlugin.set(pluginId, []);
    }

    const records = this._errorsByPlugin.get(pluginId)!;
    // Purgar errores fuera de la ventana deslizante de 5 minutos
    const recent = records.filter((r) => now - r.timestamp < this.WINDOW_MS);
    recent.push({ timestamp: now, message, context, stack });
    this._errorsByPlugin.set(pluginId, recent);

    if (recent.length >= this.MAX_ERRORS && this._onThresholdExceeded) {
      this._onThresholdExceeded(pluginId, recent.length);
    }
  }

  /**
   * Obtiene la cuenta de errores recientes para un plugin en la ventana deslizante.
   */
  public getRecentErrorCount(pluginId: string): number {
    const records = this._errorsByPlugin.get(pluginId);
    if (!records) return 0;
    const now = Date.now();
    return records.filter((r) => now - r.timestamp < this.WINDOW_MS).length;
  }

  /**
   * Limpia los errores acumulados de un plugin (p. ej. tras reiniciarlo).
   */
  public clearErrors(pluginId: string): void {
    this._errorsByPlugin.delete(pluginId);
  }

  /**
   * Instala escuchas globales para atribuir errores no capturados vía stack trace o contexto activo.
   */
  private installGlobalErrorHandlers(): void {
    if (this._globalHandlersInstalled || typeof window === 'undefined') return;
    this._globalHandlersInstalled = true;

    // 1. window.onerror
    window.addEventListener('error', (event: ErrorEvent) => {
      const pluginId = this.identifyPluginFromStack(event.error?.stack) || this.getActiveContext();
      if (pluginId) {
        this.recordError(pluginId, event.error || event.message, 'global:uncaught_error');
      }
    });

    // 2. window.onunhandledrejection
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const stack = reason instanceof Error ? reason.stack : undefined;
      const pluginId = this.identifyPluginFromStack(stack) || this.getActiveContext();
      if (pluginId) {
        this.recordError(pluginId, reason, 'global:unhandled_rejection');
      }
    });
  }

  /**
   * Extrae el pluginId desde una traza de pila con formato `indexly-plugin://${pluginId}/...`.
   */
  public identifyPluginFromStack(stack?: string): string | null {
    if (!stack) return null;
    const match = stack.match(/indexly-plugin:\/\/([^/\s:]+)/);
    return match && match[1] ? match[1] : null;
  }
}

export const safeCallManager = new SafeCallManager();
