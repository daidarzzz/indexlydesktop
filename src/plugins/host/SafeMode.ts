/**
 * @file src/plugins/host/SafeMode.ts
 * @description Gestión de Modo Restringido global y Modo Seguro por detección de cierres sucios (Dirty Exit Protection).
 */

const STORAGE_KEY_DIRTY_EXITS = 'indexly_dirty_exit_count';
const STORAGE_KEY_RESTRICTED_MODE = 'indexly_restricted_mode';
/** Tiempo tras el que una sesión arrancada se considera estable. */
const STABLE_SESSION_MS = 15_000;

/** Ventanas auxiliares (Spotlight) que no deben contar sesiones. */
function isSecondaryWindow(): boolean {
  return typeof window !== 'undefined' && /[?&]window=/.test(window.location?.search || '');
}

/**
 * Gestor de Modo Seguro y Modo Restringido.
 */
export class SafeModeManager {
  private _isSafeModeActive: boolean = false;
  private _isRestrictedModeActive: boolean = false;
  private _storage: Storage | null = null;

  constructor(storage?: Storage) {
    if (storage) {
      this._storage = storage;
    } else if (typeof localStorage !== 'undefined') {
      this._storage = localStorage;
    }
    this.evaluateStartupState();
  }

  /**
   * Indica si el Modo Seguro (Safe Mode) se encuentra activado por caídas previas.
   */
  public get isSafeModeActive(): boolean {
    return this._isSafeModeActive;
  }

  /**
   * Indica si el Modo Restringido (Restricted Mode) está configurado por el usuario.
   */
  public get isRestrictedModeActive(): boolean {
    return this._isRestrictedModeActive;
  }

  /**
   * Evalúa el estado de arranque de la aplicación.
   * Si detecta 2 o más cierres anormales consecutivos, activa el Modo Seguro.
   */
  public evaluateStartupState(): void {
    if (!this._storage) return;

    // 1. Modo restringido explícito del usuario
    const restrictedVal = this._storage.getItem(STORAGE_KEY_RESTRICTED_MODE);
    this._isRestrictedModeActive = restrictedVal === 'true';

    // Las ventanas secundarias (p. ej. Spotlight) comparten localStorage con la
    // principal pero viven ocultas y casi nunca se descargan: si contaran
    // sesiones, inflarían el contador y activarían el Modo Seguro sin motivo.
    // Sólo la ventana principal participa en la detección de cierres sucios.
    if (isSecondaryWindow()) {
      this._isSafeModeActive = false;
      return;
    }

    // 2. Contador de cierres anormales (Dirty Exits)
    const dirtyCount = parseInt(this._storage.getItem(STORAGE_KEY_DIRTY_EXITS) || '0', 10);

    if (dirtyCount >= 2) {
      this._isSafeModeActive = true;
      console.warn(
        `[SafeMode] ALERTA: Detectados ${dirtyCount} cierres inesperados consecutivos. Iniciando en MODO SEGURO (plugins desactivados).`
      );
    } else {
      this._isSafeModeActive = false;
    }

    // Registrar inicio de sesión no confirmada
    this.recordSessionStart();
  }

  /**
   * Registra el inicio de una sesión marcándola como no cerrada limpiamente.
   */
  public recordSessionStart(): void {
    if (!this._storage) return;
    const current = parseInt(this._storage.getItem(STORAGE_KEY_DIRTY_EXITS) || '0', 10);
    this._storage.setItem(STORAGE_KEY_DIRTY_EXITS, String(current + 1));

    // Instalar escucha para marcar cierre limpio
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.recordCleanExit();
      });
      // Una sesión que sobrevive al arranque se considera estable: así matar el
      // proceso (p. ej. reiniciar `tauri dev`) no se confunde con un cierre por fallo.
      setTimeout(() => this.recordCleanExit(), STABLE_SESSION_MS);
    }
  }

  /**
   * Registra que la sesión se cerró de forma limpia o se estabilizó tras el arranque.
   */
  public recordCleanExit(): void {
    if (!this._storage) return;
    this._storage.setItem(STORAGE_KEY_DIRTY_EXITS, '0');
  }

  /**
   * Activa o desactiva manualmente el Modo Restringido global.
   */
  public setRestrictedMode(active: boolean): void {
    this._isRestrictedModeActive = active;
    if (this._storage) {
      this._storage.setItem(STORAGE_KEY_RESTRICTED_MODE, String(active));
    }
  }

  /**
   * Resetea el estado del Modo Seguro tras la revisión del usuario.
   */
  public resetSafeMode(): void {
    this._isSafeModeActive = false;
    this.recordCleanExit();
  }

  /**
   * Determina si se permite la carga de plugins de terceros.
   * En Modo Seguro o Modo Restringido, la carga está bloqueada.
   */
  public canLoadPlugins(): boolean {
    return !this._isSafeModeActive && !this._isRestrictedModeActive;
  }
}

export const safeModeManager = new SafeModeManager();
