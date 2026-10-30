/**
 * @file src/plugins/test-kit/Harness.ts
 * @description Harness de pruebas instrumentado para detección de fugas de memoria, timers y listeners huérfanos.
 */

export interface TestSnapshot {
  domElementsCount: number;
  activeTimersCount: number;
  activeListenersCount: number;
}

interface TrackedListener {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
}

/**
 * Harness de pruebas con espionaje de EventTarget, temporizadores y nodos DOM.
 */
export class TestHarness {
  private _trackedListeners: TrackedListener[] = [];
  private _activeTimers: Set<any> = new Set();
  private _originalAddEventListener: typeof EventTarget.prototype.addEventListener | null = null;
  private _originalRemoveEventListener: typeof EventTarget.prototype.removeEventListener | null = null;
  private _originalSetInterval: typeof window.setInterval | null = null;
  private _originalClearInterval: typeof window.clearInterval | null = null;
  private _originalSetTimeout: typeof window.setTimeout | null = null;
  private _originalClearTimeout: typeof window.clearTimeout | null = null;

  /**
   * Instala los espías e interceptores en el entorno global.
   */
  public install(): void {
    if (this._originalAddEventListener) return;

    // 1. Espiar EventTarget
    this._originalAddEventListener = EventTarget.prototype.addEventListener;
    this._originalRemoveEventListener = EventTarget.prototype.removeEventListener;

    const self = this;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (listener) {
        self._trackedListeners.push({ target: this, type, listener });
      }
      return self._originalAddEventListener!.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (listener) {
        const idx = self._trackedListeners.findIndex(
          (t) => t.target === this && t.type === type && t.listener === listener
        );
        if (idx >= 0) {
          self._trackedListeners.splice(idx, 1);
        }
      }
      return self._originalRemoveEventListener!.call(this, type, listener, options);
    };

    // 2. Espiar setInterval
    if (typeof window !== 'undefined') {
      this._originalSetInterval = window.setInterval;
      this._originalClearInterval = window.clearInterval;

      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]): number => {
        const id = self._originalSetInterval!(handler, timeout, ...args);
        self._activeTimers.add(id);
        return id;
      }) as any;

      window.clearInterval = ((id?: any) => {
        if (id !== undefined) {
          self._activeTimers.delete(id);
          self._originalClearInterval!(id);
        }
      }) as any;

      // 3. Espiar setTimeout
      this._originalSetTimeout = window.setTimeout;
      this._originalClearTimeout = window.clearTimeout;

      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]): number => {
        const id = self._originalSetTimeout!(handler, timeout, ...args);
        self._activeTimers.add(id);
        return id;
      }) as any;

      window.clearTimeout = ((id?: any) => {
        if (id !== undefined) {
          self._activeTimers.delete(id);
          self._originalClearTimeout!(id);
        }
      }) as any;
    }
  }

  /**
   * Captura una instantánea del estado actual del entorno.
   */
  public takeSnapshot(): TestSnapshot {
    const domElementsCount = typeof document !== 'undefined' ? document.querySelectorAll('*').length : 0;
    return {
      domElementsCount,
      activeTimersCount: this._activeTimers.size,
      activeListenersCount: this._trackedListeners.length,
    };
  }

  /**
   * Comprueba que el estado actual coincida con la instantánea base (sin fugas).
   */
  public verifyClean(initialSnapshot: TestSnapshot): {
    clean: boolean;
    leakedListeners: number;
    leakedTimers: number;
    leakedElements: number;
  } {
    const current = this.takeSnapshot();
    const leakedListeners = current.activeListenersCount - initialSnapshot.activeListenersCount;
    const leakedTimers = current.activeTimersCount - initialSnapshot.activeTimersCount;
    const leakedElements = current.domElementsCount - initialSnapshot.domElementsCount;

    return {
      clean: leakedListeners === 0 && leakedTimers === 0 && leakedElements === 0,
      leakedListeners,
      leakedTimers,
      leakedElements,
    };
  }

  /**
   * Desinstala los espías y restaura las implementaciones originales.
   */
  public uninstall(): void {
    if (this._originalAddEventListener) {
      EventTarget.prototype.addEventListener = this._originalAddEventListener;
      EventTarget.prototype.removeEventListener = this._originalRemoveEventListener!;
      this._originalAddEventListener = null;
      this._originalRemoveEventListener = null;
    }

    if (this._originalSetInterval && typeof window !== 'undefined') {
      window.setInterval = this._originalSetInterval;
      window.clearInterval = this._originalClearInterval!;
      window.setTimeout = this._originalSetTimeout!;
      window.clearTimeout = this._originalClearTimeout!;
      this._originalSetInterval = null;
    }

    this._trackedListeners = [];
    this._activeTimers.clear();
  }
}

/**
 * Harness avanzado para plugins de terceros con inyección de mock y verificación automática de fugas.
 */
export class PluginTestHarness extends TestHarness {
  private _baselineSnapshot: TestSnapshot | null = null;
  public readonly app: any;

  constructor(customApp?: any) {
    super();
    // Instanciar app simulada si no se provee una
    this.app = customApp;
  }

  public override install(): void {
    super.install();
    this._baselineSnapshot = this.takeSnapshot();
  }

  /**
   * Carga e inicializa una instancia de plugin ejecutando su método `onload()`.
   */
  public async loadPlugin<T extends { onload: () => void | Promise<void>; onunload: () => void | Promise<void> }>(
    PluginCls: new (app: any, manifest: any) => T,
    manifestOverrides?: Record<string, unknown>
  ): Promise<T> {
    const manifest = {
      schemaVersion: 1,
      id: (manifestOverrides?.id as string) || 'com.test.sample-plugin',
      name: (manifestOverrides?.name as string) || 'Sample Plugin',
      version: (manifestOverrides?.version as string) || '1.0.0',
      minHostVersion: '0.1.0',
      description: 'Plugin para verificación en harness',
      author: 'Test Runner',
      license: 'MIT',
      main: 'main.js',
      ...manifestOverrides,
    };

    const plugin = new PluginCls(this.app, manifest);
    await plugin.onload();
    return plugin;
  }

  /**
   * Carga e instancia un plugin a partir de su código fuente CommonJS evaluado con el loader del host.
   */
  public async loadPluginFromCode(code: string, manifest: any): Promise<any> {
    const { pluginLoader } = await import('../host/PluginLoader');
    const instance = pluginLoader.loadPluginInstance(code, manifest, this.app);
    await instance.onload();
    return instance;
  }

  /**
   * Descarga el plugin ejecutando su método `onunload()` y purgando sus `_disposables` registrados.
   */
  public async unloadPlugin<T extends { onunload: () => void | Promise<void>; unload?: () => void | Promise<void> }>(plugin: T): Promise<void> {
    await plugin.onunload();
    if (typeof plugin.unload === 'function') {
      await plugin.unload();
    }
  }

  /**
   * Valida que no existan listeners, temporizadores ni nodos residuales en comparación con la línea base.
   */
  public expectNoLeaks(): { passed: boolean; leakedListeners: number; leakedTimers: number; leakedElements: number } {
    if (!this._baselineSnapshot) {
      throw new Error('PluginTestHarness debe instalarse mediante install() antes de invocar expectNoLeaks()');
    }
    const cleanResult = this.verifyClean(this._baselineSnapshot);
    return {
      passed: cleanResult.clean,
      leakedListeners: cleanResult.leakedListeners,
      leakedTimers: cleanResult.leakedTimers,
      leakedElements: cleanResult.leakedElements,
    };
  }
}
