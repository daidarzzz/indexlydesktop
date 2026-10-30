/**
 * @file src/plugins/__tests__/LeakDetection.test.ts
 * @description Prueba obligatoria de detección de fugas de memoria: 100 ciclos de montaje y desmontaje.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginHost } from '../host/PluginHost';
import { TestHarness } from '../test-kit/Harness';
import { PluginManifest } from '../types';
import { safeModeManager } from '../host/SafeMode';

describe('Prueba Obligatoria de Cero Fugas (100 Ciclos)', () => {
  let host: PluginHost;
  let harness: TestHarness;

  const manifest: PluginManifest = {
    schemaVersion: 1,
    id: 'com.test.leak',
    name: 'Leak Test Plugin',
    version: '1.0.0',
    minHostVersion: '0.1.0',
    description: 'Plugin intensivo para prueba de 100 ciclos',
    author: 'QA DX Team',
    license: 'MIT',
    main: 'main.js',
  };

  const codeWithEverything = `
    const { Plugin } = require('indexly');

    module.exports = class HeavyPlugin extends Plugin {
      async onload() {
        // 1. Comandos
        this.addCommand({
          id: 'heavy-cmd',
          name: 'Heavy Command',
          callback: () => {}
        });

        // 2. Elementos DOM (Ribbon y Status Bar)
        this.addRibbonIcon('star', 'Heavy Ribbon', () => {});
        this.addStatusBarItem();

        // 3. Listeners DOM
        this.registerDomEvent(window, 'resize', () => {});
        this.registerDomEvent(document, 'keydown', () => {});

        // 4. Temporizadores
        this.registerInterval(window.setInterval(() => {}, 5000));
        this.registerTimeout(window.setTimeout(() => {}, 10000));

        // 5. Suscripciones a eventos
        this.registerEvent(this.app.events.on('heavy:event', () => {}));
      }

      async onunload() {}
    };
  `;

  beforeEach(() => {
    safeModeManager.resetSafeMode();
    safeModeManager.setRestrictedMode(false);
    harness = new TestHarness();
    harness.install();
    host = new PluginHost();
  });

  afterEach(async () => {
    await host.unloadAll();
    harness.uninstall();
  });

  it('debe ejecutar 100 ciclos consecutivos de enable/disable sin dejar listeners, timers ni nodos DOM huérfanos', async () => {
    host.registerPlugin(manifest, codeWithEverything, '.heavy-style { background: blue; }');

    // 1. Capturar instantánea base antes del ciclo
    const initialSnapshot = harness.takeSnapshot();

    // 2. Ejecutar 100 ciclos de activación y descarga
    const CYCLES = 100;
    for (let i = 0; i < CYCLES; i++) {
      const enabled = await host.enablePlugin('com.test.leak');
      expect(enabled).toBe(true);

      const disabled = await host.disablePlugin('com.test.leak');
      expect(disabled).toBe(true);
    }

    // 3. Verificar que el estado del sistema volvió exactamente a la instantánea inicial
    const result = harness.verifyClean(initialSnapshot);

    expect(result.leakedListeners).toBe(0);
    expect(result.leakedTimers).toBe(0);
    expect(result.leakedElements).toBe(0);
    expect(result.clean).toBe(true);
    expect(host.sharedCommands.listCommands()).toHaveLength(0);
  });
});
