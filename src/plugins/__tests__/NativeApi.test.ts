/**
 * @file src/plugins/__tests__/NativeApi.test.ts
 * @description Suite de pruebas unitarias para la superficie nativa `app.native`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNativeApi } from '../api/NativeApi';
import { NativeError } from '../api/errors';

describe('HostNativeApi', () => {
  let native: ReturnType<typeof createNativeApi>;

  beforeEach(() => {
    vi.restoreAllMocks();
    native = createNativeApi();
  });

  describe('Control de acceso en invoke', () => {
    it('debe rechazar comandos fuera del namespace público con ERR_INVOKE_DISALLOWED', async () => {
      await expect(native.invoke('core:restart')).rejects.toThrow(NativeError);
      await expect(native.invoke('core:restart')).rejects.toMatchObject({
        code: 'ERR_INVOKE_DISALLOWED',
      });

      await expect(native.invoke('__host_private_read')).rejects.toThrow(NativeError);
      await expect(native.invoke('__host_private_read')).rejects.toMatchObject({
        code: 'ERR_INVOKE_DISALLOWED',
      });
    });

    it('debe permitir comandos en el namespace plugin:* o compatibilidad native_*', async () => {
      // Sin Tauri presente, debe arrojar ERR_NATIVE_UNAVAILABLE pero no ERR_INVOKE_DISALLOWED
      await expect(native.invoke('plugin:fs_read_text', { path: '/tmp/test.txt' })).rejects.toMatchObject({
        code: 'ERR_NATIVE_UNAVAILABLE',
      });

      await expect(native.invoke('native_sql_query', { query: 'SELECT 1' })).rejects.toMatchObject({
        code: 'ERR_NATIVE_UNAVAILABLE',
      });
    });
  });

  describe('Path API', () => {
    it('debe normalizar y combinar rutas en formato multiplataforma', () => {
      expect(native.path.join('data', 'plugins', 'my-plugin')).toBe('data/plugins/my-plugin');
      expect(native.path.join('C:\\Users\\david', 'AppData')).toBe('C:/Users/david/AppData');
      expect(native.path.dirname('/home/user/file.txt')).toBe('/home/user');
      expect(native.path.basename('/home/user/file.txt')).toBe('file.txt');
      expect(native.path.extname('/home/user/file.txt')).toBe('.txt');
      expect(native.path.extname('/home/user/archive.tar.gz')).toBe('.gz');
      expect(native.path.extname('/home/user/noext')).toBe('');
    });
  });

  describe('Shortcuts API', () => {
    it('debe registrar y desregistrar atajos', async () => {
      const cb1 = vi.fn();
      const unreg1 = await native.shortcuts.register('Ctrl+Shift+P', cb1);
      expect(typeof unreg1).toBe('function');

      unreg1();
      await native.shortcuts.unregister('Ctrl+Shift+P');
    });
  });

  describe('Windows API', () => {
    it('debe proporcionar métodos de ventana consistentes', async () => {
      const winId = await native.windows.create({
        label: 'editor',
        title: 'Editor de notas',
      });

      expect(winId).toBe('editor');

      const list = await native.windows.list();
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].label).toBe('main');

      await expect(native.windows.focus('editor')).resolves.toBeUndefined();
      await expect(native.windows.close('editor')).resolves.toBeUndefined();
    });
  });

  describe('Net y Shell API', () => {
    it('debe proveer fetch y openUrl', () => {
      expect(typeof native.net.fetch).toBe('function');
      expect(typeof native.shell.openUrl).toBe('function');
    });
  });

  describe('OS API', () => {
    it('debe proveer información del sistema operativo', async () => {
      expect(['windows', 'macos', 'linux']).toContain(native.os.platform());
      expect(typeof native.os.arch()).toBe('string');
      expect(typeof native.os.locale()).toBe('string');
    });
  });
});
