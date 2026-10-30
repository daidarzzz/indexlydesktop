/**
 * @file src/plugins/__tests__/SamplePlugins.test.ts
 * @description Suite de verificación automatizada de los 3 plugins de referencia oficiales leyendo sus archivos reales en disco:
 * 1. Hello Command (plugins/sample-hello-command)
 * 2. Custom View (plugins/sample-custom-view-react)
 * 3. Importer CSV (plugins/sample-importer-csv)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createMockApp, PluginTestHarness } from '../test-kit';

describe('Sample Reference Plugins (Archivos reales en disco)', () => {
  let harness: PluginTestHarness;
  const rootDir = path.resolve(__dirname, '../../..');

  beforeEach(() => {
    harness = new PluginTestHarness(createMockApp());
    harness.install();
  });

  afterEach(() => {
    harness.uninstall();
  });

  describe('1. Sample Hello Command (com.indexly.sample-hello-command)', () => {
    it('debe registrar comandos, persistir estado en disco y descargarse sin fugas', async () => {
      const pluginDir = path.join(rootDir, 'plugins/sample-hello-command');
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
      const code = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');

      // 1. Cargar plugin mediante harness y loader CJS sintético
      const plugin = await harness.loadPluginFromCode(code, manifest);
      expect(plugin).toBeDefined();

      // 2. Ejecutar comando 'greet-user'
      await harness.app.commands.executeCommand('greet-user');

      // 3. Comprobar datos guardados en el almacenamiento privado del plugin
      const savedData = await plugin.loadData();
      expect(savedData).toBeDefined();
      expect(savedData.greetingsCount).toBe(1);

      // 4. Desactivar y descargar plugin
      await harness.unloadPlugin(plugin);

      // 5. El comando debe haber sido purgado (retorna false)
      const res = await harness.app.commands.executeCommand('greet-user');
      expect(res).toBe(false);

      // 6. Validar que no haya fugas residuales
      const leaks = harness.expectNoLeaks();
      expect(leaks.passed).toBe(true);
      expect(leaks.leakedTimers).toBe(0);
      expect(leaks.leakedListeners).toBe(0);
    });
  });

  describe('2. Sample Custom View (com.indexly.sample-custom-view-react)', () => {
    it('debe montar la vista personalizada en WorkspaceLeaf, reaccionar a eventos y limpiarse', async () => {
      const pluginDir = path.join(rootDir, 'plugins/sample-custom-view-react');
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
      const code = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');

      const plugin = await harness.loadPluginFromCode(code, manifest);
      expect(plugin).toBeDefined();

      // Abrir vista mediante su comando
      await harness.app.commands.executeCommand('open-analytics-view');
      const leaf = harness.app.workspace.getLeaf('indexly-analytics-view');
      expect(leaf).not.toBeNull();
      expect(leaf?.view?.containerEl.querySelector('.indexly-analytics-title')).not.toBeNull();

      // Emitir evento reactivo de biblioteca
      harness.app.events.emit('source:added', { id: 's1', name: 'Nueva Fuente', count: 5 });

      // Desactivar plugin: debe cerrar hojas y desacoplar
      await harness.unloadPlugin(plugin);

      const openLeaves = harness.app.workspace
        .getLeaves()
        .filter((l: any) => l.view && l.view.getViewType() === 'indexly-analytics-view');
      expect(openLeaves).toHaveLength(0);

      const leaks = harness.expectNoLeaks();
      expect(leaks.passed).toBe(true);
      expect(leaks.leakedListeners).toBe(0);
    });
  });

  describe('3. Sample Importer CSV (com.indexly.sample-importer-csv)', () => {
    it('debe registrar el importador y parsear datos tabulares con streaming de progreso', async () => {
      const pluginDir = path.join(rootDir, 'plugins/sample-importer-csv');
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
      const code = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');

      const plugin = await harness.loadPluginFromCode(code, manifest);
      expect(plugin).toBeDefined();

      const csvContent = 'title,link,size\nUbuntu 24.04,magnet:?xt=urn:btih:ubuntu,4.5 GB\nArch Linux,magnet:?xt=urn:btih:arch,1.1 GB';

      // Escuchar eventos de progreso
      const progressEvents: any[] = [];
      harness.app.events.on('import:progress', (data: any) => {
        progressEvents.push(data);
      });

      // Ejecutar importFile a través de la API del host
      const sources = await harness.app.importer.importFile(csvContent, { filename: 'linux.csv' });
      expect(sources.length).toBe(1);
      expect(sources[0].name).toBe('linux.csv');
      expect(sources[0].count).toBe(2);
      expect(progressEvents.length).toBeGreaterThan(0);

      // Desactivar plugin
      await harness.unloadPlugin(plugin);

      const leaks = harness.expectNoLeaks();
      expect(leaks.passed).toBe(true);
      expect(leaks.leakedListeners).toBe(0);
    });
  });

  describe('4. Sample Scratchpad & Notes (com.indexly.sample-scratchpad-notes)', () => {
    it('debe crear notas, persistir en disco, interactuar con portapapeles y descargarse sin fugas', async () => {
      const pluginDir = path.join(rootDir, 'plugins/sample-scratchpad-notes');
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
      const code = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');

      // 1. Cargar el plugin
      const plugin = await harness.loadPluginFromCode(code, manifest);
      expect(plugin).toBeDefined();

      // 2. Verificar notas iniciales y comandos
      expect(plugin.state.notes.length).toBeGreaterThanOrEqual(1);

      // 3. Abrir vista
      await harness.app.commands.executeCommand('open-scratchpad');
      const leaf = harness.app.workspace.getLeaf('indexly-scratchpad-view');
      expect(leaf).not.toBeNull();
      expect(leaf?.view?.getViewType()).toBe('indexly-scratchpad-view');

      // 4. Crear nueva nota mediante comando
      const initialCount = plugin.state.notes.length;
      await harness.app.commands.executeCommand('new-note');
      expect(plugin.state.notes.length).toBe(initialCount + 1);

      // 5. Copiar nota al portapapeles nativo
      await harness.app.commands.executeCommand('copy-active-note');

      // 6. Verificar persistencia de datos
      const saved = await plugin.loadData();
      expect(saved.notes.length).toBe(plugin.state.notes.length);

      // 7. Descargar plugin
      await harness.unloadPlugin(plugin);

      // 8. Verificar que no queden hojas abiertas
      const openLeaves = harness.app.workspace
        .getLeaves()
        .filter((l: any) => l.view && l.view.getViewType() === 'indexly-scratchpad-view');
      expect(openLeaves).toHaveLength(0);

      // 9. Comprobar ausencia matemática de fugas
      const leaks = harness.expectNoLeaks();
      expect(leaks.passed).toBe(true);
      expect(leaks.leakedTimers).toBe(0);
      expect(leaks.leakedListeners).toBe(0);
    });
  });
});
