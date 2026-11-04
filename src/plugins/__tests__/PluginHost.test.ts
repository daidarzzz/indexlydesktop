/**
 * @file src/plugins/__tests__/PluginHost.test.ts
 * @description Pruebas de integración del ciclo de vida y orquestación de PluginHost.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginHost, detectPluginRuntime } from '../host/PluginHost';
import { PluginManifest } from '../types';
import { safeModeManager } from '../host/SafeMode';

describe('PluginHost - Registro y Ciclo de Vida', () => {
  let host: PluginHost;

  const sampleManifest: PluginManifest = {
    schemaVersion: 1,
    id: 'com.test.sample',
    name: 'Sample Plugin',
    version: '1.0.0',
    minHostVersion: '0.1.0',
    description: 'Plugin de prueba',
    author: 'Tester',
    license: 'MIT',
    main: 'main.js',
  };

  beforeEach(() => {
    safeModeManager.resetSafeMode();
    safeModeManager.setRestrictedMode(false);
    host = new PluginHost();
  });

  afterEach(async () => {
    await host.unloadAll();
  });

  it('debe registrar y activar un plugin con comandos y ribbon icons', async () => {
    const pluginCode = `
      const { Plugin } = require('indexly');

      module.exports = class TestPlugin extends Plugin {
        async onload() {
          this.addCommand({
            id: 'test-cmd',
            name: 'Comando de Prueba',
            callback: () => {}
          });

          this.addRibbonIcon('star', 'Estrella', () => {});
        }

        async onunload() {}
      };
    `;

    host.registerPlugin(sampleManifest, pluginCode);
    const enabled = await host.enablePlugin('com.test.sample');

    expect(enabled).toBe(true);
    expect(host.isPluginLoaded('com.test.sample')).toBe(true);
    expect(host.sharedCommands.listCommands().some((c) => c.id === 'test-cmd')).toBe(true);
    expect(document.querySelector('.indexly-ribbon-item[data-plugin-id="com.test.sample"]')).not.toBeNull();

    // Desactivar y verificar limpieza completa
    const disabled = await host.disablePlugin('com.test.sample');
    expect(disabled).toBe(true);
    expect(host.isPluginLoaded('com.test.sample')).toBe(false);
    expect(host.sharedCommands.listCommands().some((c) => c.id === 'test-cmd')).toBe(false);
    expect(document.querySelector('.indexly-ribbon-item[data-plugin-id="com.test.sample"]')).toBeNull();
  });

  it('debe inyectar y eliminar estilos CSS de forma limpia', async () => {
    const pluginCode = `
      const { Plugin } = require('indexly');
      module.exports = class CssPlugin extends Plugin {
        async onload() {}
        async onunload() {}
      };
    `;
    const cssContent = '.plx-sample { color: red; }';

    host.registerPlugin(sampleManifest, pluginCode, cssContent);
    await host.enablePlugin('com.test.sample');

    const styleTag = document.querySelector('style[data-plugin-id="com.test.sample"]');
    expect(styleTag).not.toBeNull();
    expect(styleTag?.textContent).toBe(cssContent);

    await host.disablePlugin('com.test.sample');
    expect(document.querySelector('style[data-plugin-id="com.test.sample"]')).toBeNull();
  });

  it('debe abortar la activación si onload supera el timeout', async () => {
    vi.useFakeTimers();

    const slowPluginCode = `
      const { Plugin } = require('indexly');
      module.exports = class SlowPlugin extends Plugin {
        async onload() {
          // Promesa que nunca resuelve
          return new Promise(() => {});
        }
      };
    `;

    host.registerPlugin(sampleManifest, slowPluginCode);

    const enablePromise = host.enablePlugin('com.test.sample');

    // Avanzar temporizador simulado 10 segundos
    await vi.advanceTimersByTimeAsync(10050);

    const result = await enablePromise;
    expect(result).toBe(false);
    expect(host.isPluginLoaded('com.test.sample')).toBe(false);

    const info = host.getLoadedPlugins().find((p) => p.manifest.id === 'com.test.sample');
    expect(info?.hasError).toBe(true);
    expect(info?.lastError).toContain('superó el tiempo límite de 10000ms');

    vi.useRealTimers();
  });

  it('debe marcar el plugin como fallido si onload lanza una excepción', async () => {
    const brokenPluginCode = `
      const { Plugin } = require('indexly');
      module.exports = class BrokenPlugin extends Plugin {
        async onload() {
          throw new Error('fallo controlado en onload');
        }
      };
    `;

    host.registerPlugin(sampleManifest, brokenPluginCode);
    const enabled = await host.enablePlugin('com.test.sample');

    expect(enabled).toBe(false);
    expect(host.isPluginLoaded('com.test.sample')).toBe(false);
    expect(host.getPluginState('com.test.sample')).toBe('failed');

    const info = host.getLoadedPlugins().find((p) => p.manifest.id === 'com.test.sample');
    expect(info?.hasError).toBe(true);
    expect(info?.lastError).toContain('fallo controlado en onload');
  });

  it('debe serializar activaciones concurrentes del mismo plugin', async () => {
    (globalThis as any).__indexlyLoadCount = 0;
    const pluginCode = `
      const { Plugin } = require('indexly');
      module.exports = class ConcurrentPlugin extends Plugin {
        async onload() {
          globalThis.__indexlyLoadCount = (globalThis.__indexlyLoadCount || 0) + 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
    `;

    host.registerPlugin(sampleManifest, pluginCode);
    const results = await Promise.all([
      host.enablePlugin('com.test.sample'),
      host.enablePlugin('com.test.sample'),
      host.enablePlugin('com.test.sample'),
    ]);

    expect(results).toEqual([true, true, true]);
    expect((globalThis as any).__indexlyLoadCount).toBe(1);
    delete (globalThis as any).__indexlyLoadCount;
  });

  it('debe detectar el runtime por manifiesto y usar el adaptador legacy', async () => {
    expect(detectPluginRuntime({ id: 'legacy', name: 'Legacy' })).toBe('legacy');
    expect(detectPluginRuntime({ ...sampleManifest })).toBe('modern');

    const unloadSpy = vi.fn();
    host.registerRuntimeAdapter({
      kind: 'legacy',
      load: () => ({ onload: async () => {} }),
      unload: unloadSpy,
    });

    const legacyManifest = {
      id: 'legacy.test',
      name: 'Legacy Test',
      version: '1.0.0',
      description: '',
      author: 'Tester',
      license: 'MIT',
      main: 'index.js',
    } as unknown as PluginManifest;

    host.registerPlugin(legacyManifest, 'IndexLy.plugin({ activate() {} });', undefined, {
      runtime: 'legacy',
    });

    expect(await host.enablePlugin('legacy.test')).toBe(true);
    expect(host.getPluginState('legacy.test')).toBe('active');
    expect(await host.disablePlugin('legacy.test')).toBe(true);
    expect(unloadSpy).toHaveBeenCalledTimes(1);
  });

  it('debe detectar cambios de bundle y recargar el código nuevo', async () => {
    const v1 = `
      const { Plugin } = require('indexly');
      module.exports = class extends Plugin { async onload() {} };
    `;
    const v2 = `
      const { Plugin } = require('indexly');
      module.exports = class extends Plugin {
        async onload() { globalThis.__indexlyVersion = 2; }
      };
    `;

    host.registerPlugin(sampleManifest, v1);
    expect(host.hasBundleChanged('com.test.sample', v1)).toBe(false);
    expect(await host.enablePlugin('com.test.sample')).toBe(true);

    expect(host.hasBundleChanged('com.test.sample', v2)).toBe(true);
    host.registerPlugin(sampleManifest, v2);
    expect(await host.reloadPlugin('com.test.sample')).toBe(true);
    expect((globalThis as any).__indexlyVersion).toBe(2);

    delete (globalThis as any).__indexlyVersion;
  });
});
