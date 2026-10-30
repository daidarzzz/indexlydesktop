/**
 * @file src/plugins/__tests__/SafeCall.test.ts
 * @description Pruebas de aislamiento de excepciones, umbral de errores y atribución.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SafeCallManager } from '../host/SafeCall';

describe('SafeCallManager', () => {
  let safeCall: SafeCallManager;

  beforeEach(() => {
    safeCall = new SafeCallManager();
  });

  it('debe capturar excepciones sin propagarlas al invocador', async () => {
    const errorFn = vi.fn().mockImplementation(() => {
      throw new Error('Fallo crítico en plugin');
    });

    const result = await safeCall.safeCall('plugin-roto', errorFn, 'test-crash');

    expect(result).toBeUndefined();
    expect(safeCall.getRecentErrorCount('plugin-roto')).toBe(1);
  });

  it('debe registrar y retornar valores exitosos', async () => {
    const okFn = vi.fn().mockResolvedValue('resultado-exitoso');

    const result = await safeCall.safeCall('plugin-bueno', okFn, 'test-ok');

    expect(result).toBe('resultado-exitoso');
    expect(safeCall.getRecentErrorCount('plugin-bueno')).toBe(0);
  });

  it('debe disparar onThresholdExceeded tras 10 errores en la ventana deslizante', async () => {
    const thresholdListener = vi.fn();
    safeCall.onThresholdExceeded(thresholdListener);

    for (let i = 0; i < 9; i++) {
      await safeCall.safeCall('plugin-reincidente', () => {
        throw new Error(`Error ${i}`);
      });
    }

    expect(thresholdListener).not.toHaveBeenCalled();

    // El error número 10 dispara el callback
    await safeCall.safeCall('plugin-reincidente', () => {
      throw new Error('Error número 10');
    });

    expect(thresholdListener).toHaveBeenCalledWith('plugin-reincidente', 10);
  });

  it('debe extraer el pluginId desde una traza de pila con virtual sourceURL', () => {
    const fakeStack = `Error: Algo explotó
    at MiPlugin.onload (indexly-plugin://com.autor.miplugin/main.js:14:15)
    at SafeCallManager.safeCall (SafeCall.ts:45:10)`;

    const identified = safeCall.identifyPluginFromStack(fakeStack);
    expect(identified).toBe('com.autor.miplugin');
  });
});
