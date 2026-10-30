/**
 * @file src/plugins/__tests__/PluginTestKit.test.ts
 * @description Pruebas unitarias para el paquete `@indexly/plugin-test-kit` (`createMockApp` y `PluginTestHarness`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockApp, PluginTestHarness } from '../test-kit';
import { Plugin } from '../api/Plugin';

describe('Plugin Test Kit (@indexly/plugin-test-kit)', () => {
  describe('createMockApp', () => {
    it('debe crear un entorno mock completo con todas las propiedades raíz de App', async () => {
      const app = createMockApp();

      expect(app.version).toBe('0.1.0');
      expect(app.apiVersion).toBe('1.0.0');
      expect(app.features).toBeDefined();
      expect(app.library).toBeDefined();
      expect(app.search).toBeDefined();
      expect(app.workspace).toBeDefined();
      expect(app.commands).toBeDefined();
      expect(app.settings).toBeDefined();
      expect(app.importer).toBeDefined();
      expect(app.hub).toBeDefined();
      expect(app.native).toBeDefined();
      expect(app.events).toBeDefined();
      expect(app.storage).toBeDefined();
      expect(app.ui).toBeDefined();
      expect(app.legacy).toBeDefined();
    });

    it('debe permitir añadir y consultar fuentes e ítems en la biblioteca simulada', async () => {
      const app = createMockApp();
      const addedListener = vi.fn();
      app.library.on('source:added', addedListener);

      const source = await app.library.addSource({ name: 'Mis Torrents' });
      expect(source.name).toBe('Mis Torrents');
      expect(addedListener).toHaveBeenCalledWith(source);

      const sources = await app.library.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe(source.id);
    });

    it('debe soportar streaming cooperativo en búsqueda con AbortSignal', async () => {
      const app = createMockApp();
      const controller = new AbortController();

      const generator = app.search.queryStream('test', { signal: controller.signal });
      controller.abort();

      await expect(async () => {
        for await (const _item of generator) {
          // consumo
        }
      }).rejects.toThrow('cancelada');
    });

    it('debe permitir operaciones fs y keychain en app.native simulado', async () => {
      const app = createMockApp();

      await app.native.fs.write('/test/config.json', JSON.stringify({ key: 'val' }));
      const readText = await app.native.fs.readText('/test/config.json');
      expect(JSON.parse(readText)).toEqual({ key: 'val' });

      await app.native.keychain.set('api_token', 'sec_12345');
      const token = await app.native.keychain.get('api_token');
      expect(token).toBe('sec_12345');

      await app.native.keychain.delete('api_token');
      const deleted = await app.native.keychain.get('api_token');
      expect(deleted).toBeNull();
    });
  });

  describe('PluginTestHarness', () => {
    let harness: PluginTestHarness;

    beforeEach(() => {
      harness = new PluginTestHarness(createMockApp());
      harness.install();
    });

    afterEach(() => {
      harness.uninstall();
    });

    it('debe cargar, ejecutar ciclo y validar ausencia de fugas en un plugin limpio', async () => {
      let commandExecuted = false;

      class CleanPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'test-clean',
            name: 'Comando Limpio',
            callback: () => {
              commandExecuted = true;
            },
          });

          this.registerInterval(window.setInterval(() => {}, 1000));
          this.registerDomEvent(window, 'resize', () => {});
        }

        async onunload(): Promise<void> {
          await super.onunload();
        }
      }

      const plugin = await harness.loadPlugin(CleanPlugin, { id: 'com.test.clean' });
      expect(plugin).toBeDefined();

      // Ejecutar comando registrado
      await harness.app.commands.executeCommand('test-clean');
      expect(commandExecuted).toBe(true);

      // Descargar plugin
      await harness.unloadPlugin(plugin);

      // Comprobar ausencia de fugas
      const leaks = harness.expectNoLeaks();
      expect(leaks.passed).toBe(true);
      expect(leaks.leakedTimers).toBe(0);
      expect(leaks.leakedListeners).toBe(0);
      expect(leaks.leakedElements).toBe(0);
    });

    it('debe detectar fugas si un plugin no limpia sus temporizadores nativos', async () => {
      class LeakyPlugin extends Plugin {
        onload() {
          // Fuga deliberada: usa window.setInterval sin registrarlo con this.registerInterval
          window.setInterval(() => {}, 500);
        }
      }

      const plugin = await harness.loadPlugin(LeakyPlugin, { id: 'com.test.leaky' });
      await harness.unloadPlugin(plugin);

      const leaks = harness.expectNoLeaks();
      expect(leaks.passed).toBe(false);
      expect(leaks.leakedTimers).toBeGreaterThan(0);
    });
  });
});
