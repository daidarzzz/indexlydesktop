/**
 * @file src/plugins/test-kit/MockApp.ts
 * @description Fábrica de mocks ligeros e interactivos de la interfaz `App` para tests unitarios de plugins.
 */

import { App, NativeApi } from '../types';
import { createAppInstance } from '../api/App';

/**
 * Fábrica para instanciar un objeto `App` simulado con almacenamiento en memoria
 * y APIs completamente funcionales para tests de plugins de terceros.
 *
 * @param overrides Sobrescritura parcial opcional de propiedades o subsistemas.
 * @returns Instancia simulada de `App`.
 */
export function createMockApp(overrides?: Partial<App>): App {
  const base = createAppInstance('mock-test-plugin');
  const inMemoryFs = new Map<string, string | Uint8Array>();
  const inMemoryKeychain = new Map<string, string>();

  // Suministrar fs y keychain en memoria si Tauri IPC no está activo en este entorno de test
  const mockNative: NativeApi = {
    ...base.native,
    fs: {
      ...base.native.fs,
      async read(path: string): Promise<Uint8Array> {
        const val = inMemoryFs.get(path);
        if (val === undefined) throw new Error(`ENOENT: ${path}`);
        return typeof val === 'string' ? new TextEncoder().encode(val) : val;
      },
      async readText(path: string): Promise<string> {
        const val = inMemoryFs.get(path);
        if (val === undefined) throw new Error(`ENOENT: ${path}`);
        return typeof val === 'string' ? val : new TextDecoder().decode(val);
      },
      async write(path: string, data: Uint8Array | string): Promise<void> {
        inMemoryFs.set(path, data);
      },
    },
    keychain: {
      ...base.native.keychain,
      async get(key: string): Promise<string | null> {
        return inMemoryKeychain.get(key) || null;
      },
      async set(key: string, secret: string): Promise<void> {
        inMemoryKeychain.set(key, secret);
      },
      async delete(key: string): Promise<void> {
        inMemoryKeychain.delete(key);
      },
    },
  };

  return {
    ...base,
    native: mockNative,
    ...overrides,
  };
}
