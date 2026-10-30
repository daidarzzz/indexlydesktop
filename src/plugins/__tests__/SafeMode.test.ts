/**
 * @file src/plugins/__tests__/SafeMode.test.ts
 * @description Pruebas unitarias para SafeMode (detección de dirty exits) y Modo Restringido.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SafeModeManager } from '../host/SafeMode';

class MockStorage implements Storage {
  private _data = new Map<string, string>();
  get length() {
    return this._data.size;
  }
  clear(): void {
    this._data.clear();
  }
  getItem(key: string): string | null {
    return this._data.has(key) ? this._data.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this._data.keys())[index] || null;
  }
  removeItem(key: string): void {
    this._data.delete(key);
  }
  setItem(key: string, value: string): void {
    this._data.set(key, value);
  }
}

describe('SafeModeManager', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  it('debe iniciar normalmente con 0 o 1 cierres sucios', () => {
    mockStorage.setItem('indexly_dirty_exit_count', '1');
    const safeMode = new SafeModeManager(mockStorage);

    expect(safeMode.isSafeModeActive).toBe(false);
    expect(safeMode.canLoadPlugins()).toBe(true);
  });

  it('debe activar el Modo Seguro si detecta 2 cierres anormales consecutivos', () => {
    mockStorage.setItem('indexly_dirty_exit_count', '2');
    const safeMode = new SafeModeManager(mockStorage);

    expect(safeMode.isSafeModeActive).toBe(true);
    expect(safeMode.canLoadPlugins()).toBe(false);
  });

  it('debe resetear el contador al registrar un cierre limpio', () => {
    mockStorage.setItem('indexly_dirty_exit_count', '3');
    const safeMode = new SafeModeManager(mockStorage);

    expect(safeMode.isSafeModeActive).toBe(true);
    safeMode.recordCleanExit();

    expect(mockStorage.getItem('indexly_dirty_exit_count')).toBe('0');
  });

  it('debe respetar el Modo Restringido manual configurado por el usuario', () => {
    const safeMode = new SafeModeManager(mockStorage);
    expect(safeMode.canLoadPlugins()).toBe(true);

    safeMode.setRestrictedMode(true);
    expect(safeMode.isRestrictedModeActive).toBe(true);
    expect(safeMode.canLoadPlugins()).toBe(false);

    safeMode.setRestrictedMode(false);
    expect(safeMode.isRestrictedModeActive).toBe(false);
    expect(safeMode.canLoadPlugins()).toBe(true);
  });
});
