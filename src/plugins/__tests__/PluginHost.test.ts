/**
 * @file src/plugins/__tests__/PluginHost.test.ts
 * @description Pruebas de integración del ciclo de vida y orquestación de PluginHost.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginHost } from '../host/PluginHost';
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
});
