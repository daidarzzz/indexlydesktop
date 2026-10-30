/**
 * @file src/plugins/api/errors.ts
 * @description Taxonomía formal de errores estructurados para el runtime de plugins de IndexLy.
 */

/**
 * Error raíz de toda excepción originada en el ecosistema de plugins de IndexLy.
 */
export class IndexlyError extends Error {
  /** Código canónico de error (p. ej. 'ERR_PLUGIN_TIMEOUT') */
  public readonly code: string;
  /** Identificador del plugin causante, si está disponible */
  public readonly pluginId?: string;
  /** Causa original del error para encadenamiento diagnósticos */
  public readonly cause?: unknown;

  constructor(message: string, code: string, pluginId?: string, cause?: unknown) {
    super(message);
    this.name = 'IndexlyError';
    this.code = code;
    this.pluginId = pluginId;
    this.cause = cause;
    // Mantener trazabilidad adecuada en V8 si está disponible
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error producido durante las transiciones de ciclo de vida (carga, activación, descarga).
 */
export class PluginLifecycleError extends IndexlyError {
  constructor(message: string, pluginId: string, cause?: unknown) {
    super(message, 'ERR_PLUGIN_LIFECYCLE', pluginId, cause);
    this.name = 'PluginLifecycleError';
  }
}

/**
 * Error disparado cuando un hook del ciclo de vida (`onload` o `onunload`) supera el límite de tiempo.
 */
export class PluginTimeoutError extends IndexlyError {
  /** Fase en la que se produjo el timeout */
  public readonly phase: 'onload' | 'onunload';
  /** Tiempo límite configurado en milisegundos */
  public readonly timeoutMs: number;

  constructor(pluginId: string, phase: 'onload' | 'onunload', timeoutMs: number) {
    const message = `El plugin '${pluginId}' superó el tiempo límite de ${timeoutMs}ms en la fase '${phase}'`;
    const code = phase === 'onload' ? 'ERR_PLUGIN_ONLOAD_TIMEOUT' : 'ERR_PLUGIN_ONUNLOAD_TIMEOUT';
    super(message, code, pluginId);
    this.name = 'PluginTimeoutError';
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error producido en la interacción con el backend nativo de Tauri o llamadas a `app.native`.
 */
export class NativeError extends IndexlyError {
  constructor(message: string, code: string = 'ERR_NATIVE_FAILURE', cause?: unknown) {
    super(message, code, undefined, cause);
    this.name = 'NativeError';
  }
}

/**
 * Error en operaciones de persistencia de datos atómicos o sistema de archivos del plugin.
 */
export class StorageError extends IndexlyError {
  constructor(message: string, code: string = 'ERR_STORAGE_FAILURE', pluginId?: string, cause?: unknown) {
    super(message, code, pluginId, cause);
    this.name = 'StorageError';
  }
}

/**
 * Error en la validación formal del manifiesto o esquemas de configuración.
 */
export class ValidationError extends IndexlyError {
  constructor(message: string, code: string = 'ERR_VALIDATION_FAILURE', pluginId?: string) {
    super(message, code, pluginId);
    this.name = 'ValidationError';
  }
}
