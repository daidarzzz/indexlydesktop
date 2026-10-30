/**
 * @file src/plugins/__tests__/ApiSnapshot.test.ts
 * @description Test de regresión del Contrato Dorado (Golden Contract) para la API pública de IndexLy.
 * Garantiza que cualquier cambio a la superficie pública sea estrictamente aditivo.
 */

import { describe, it, expect } from 'vitest';
import * as Indexly from '../index';
import { createAppInstance } from '../api/App';

describe('Golden Contract API Snapshot (indexly v1)', () => {
  it('debe exportar todas las clases base y componentes obligatorios', () => {
    expect(Indexly.Plugin).toBeDefined();
    expect(Indexly.Component).toBeDefined();
    expect(Indexly.Modal).toBeDefined();
    expect(Indexly.PluginSettingTab).toBeDefined();
    expect(Indexly.Setting).toBeDefined();
    expect(Indexly.Notice).toBeDefined();
    expect(Indexly.Menu).toBeDefined();
    expect(Indexly.SuggestModal).toBeDefined();
    expect(Indexly.FuzzySuggestModal).toBeDefined();
  });

  it('debe exportar la taxonomía completa de errores tipados', () => {
    expect(Indexly.IndexlyError).toBeDefined();
    expect(Indexly.PluginTimeoutError).toBeDefined();
    expect(Indexly.ZombifiedPluginError).toBeDefined();
    expect(Indexly.PluginCrashError).toBeDefined();
    expect(Indexly.ValidationError).toBeDefined();
    expect(Indexly.NativeError).toBeDefined();
    expect(Indexly.AccessDeniedError).toBeDefined();
  });

  it('debe exportar herramientas de testing y harness de desarrollo', () => {
    expect(Indexly.TestHarness).toBeDefined();
    expect(Indexly.PluginTestHarness).toBeDefined();
    expect(Indexly.createMockApp).toBeDefined();
  });

  it('debe validar la superficie completa del objeto raíz App', () => {
    const app = createAppInstance('snapshot-test');

    const expectedRootKeys = [
      'version',
      'apiVersion',
      'features',
      'library',
      'search',
      'workspace',
      'commands',
      'settings',
      'importer',
      'hub',
      'native',
      'events',
      'storage',
      'ui',
      'legacy',
    ];

    for (const key of expectedRootKeys) {
      expect(app, `La propiedad raíz 'app.${key}' debe existir en App`).toHaveProperty(key);
    }

    expect(app.apiVersion).toBe('1.0.0');
  });

  it('debe validar la superficie modular de los subsistemas de App', () => {
    const app = createAppInstance('snapshot-test');

    // 1. app.library
    expect(typeof app.library.getSources).toBe('function');
    expect(typeof app.library.getSource).toBe('function');
    expect(typeof app.library.addSource).toBe('function');
    expect(typeof app.library.updateSource).toBe('function');
    expect(typeof app.library.removeSource).toBe('function');
    expect(typeof app.library.getItems).toBe('function');
    expect(typeof app.library.getItem).toBe('function');
    expect(typeof app.library.on).toBe('function');

    // 2. app.search
    expect(typeof app.search.query).toBe('function');
    expect(typeof app.search.queryStream).toBe('function');
    expect(typeof app.search.registerProvider).toBe('function');
    expect(typeof app.search.unregisterProvider).toBe('function');
    expect(typeof app.search.reindex).toBe('function');
    expect(typeof app.search.on).toBe('function');

    // 3. app.workspace
    expect(typeof app.workspace.getActiveWindow).toBe('function');
    expect(typeof app.workspace.getWindows).toBe('function');
    expect(typeof app.workspace.getLeaves).toBe('function');
    expect(typeof app.workspace.getLeaf).toBe('function');
    expect(typeof app.workspace.revealLeaf).toBe('function');
    expect(typeof app.workspace.detachLeavesOfType).toBe('function');
    expect(typeof app.workspace.onLayoutReady).toBe('function');
    expect(typeof app.workspace.on).toBe('function');
    expect(typeof app.workspace.openSpotlight).toBe('function');

    // 4. app.commands
    expect(typeof app.commands.addCommand).toBe('function');
    expect(typeof app.commands.removeCommand).toBe('function');
    expect(typeof app.commands.executeCommand).toBe('function');
    expect(typeof app.commands.listCommands).toBe('function');
    expect(typeof app.commands.addContextMenuItem).toBe('function');

    // 5. app.settings
    expect(typeof app.settings.registerSection).toBe('function');
    expect(typeof app.settings.registerTab).toBe('function');
    expect(typeof app.settings.get).toBe('function');
    expect(typeof app.settings.set).toBe('function');
    expect(typeof app.settings.onChange).toBe('function');

    // 6. app.importer
    expect(typeof app.importer.registerImporter).toBe('function');
    expect(typeof app.importer.importFile).toBe('function');
    expect(typeof app.importer.on).toBe('function');

    // 7. app.hub
    expect(typeof app.hub.search).toBe('function');
    expect(typeof app.hub.getPlugin).toBe('function');
    expect(typeof app.hub.install).toBe('function');
    expect(typeof app.hub.update).toBe('function');
    expect(typeof app.hub.uninstall).toBe('function');
    expect(typeof app.hub.listInstalled).toBe('function');

    // 8. app.events
    expect(typeof app.events.on).toBe('function');
    expect(typeof app.events.off).toBe('function');
    expect(typeof app.events.emit).toBe('function');

    // 9. app.storage
    expect(typeof app.storage.pluginDataDir).toBe('function');
    expect(typeof app.storage.readJson).toBe('function');
    expect(typeof app.storage.writeJson).toBe('function');
    expect(typeof app.storage.readText).toBe('function');
    expect(typeof app.storage.writeText).toBe('function');
    expect(typeof app.storage.remove).toBe('function');

    // 10. app.ui
    expect(typeof app.ui.getTheme).toBe('function');
    expect(typeof app.ui.onThemeChange).toBe('function');

    // 11. app.native
    expect(typeof app.native.invoke).toBe('function');
    expect(app.native.fs).toBeDefined();
    expect(typeof app.native.fs.read).toBe('function');
    expect(typeof app.native.fs.readText).toBe('function');
    expect(typeof app.native.fs.write).toBe('function');
    expect(typeof app.native.fs.readDir).toBe('function');
    expect(typeof app.native.fs.mkdir).toBe('function');
    expect(typeof app.native.fs.remove).toBe('function');
    expect(typeof app.native.fs.rename).toBe('function');
    expect(typeof app.native.fs.stat).toBe('function');
    expect(typeof app.native.fs.watch).toBe('function');

    expect(app.native.path).toBeDefined();
    expect(typeof app.native.path.join).toBe('function');
    expect(typeof app.native.path.resolve).toBe('function');
    expect(typeof app.native.path.dirname).toBe('function');
    expect(typeof app.native.path.basename).toBe('function');
    expect(typeof app.native.path.extname).toBe('function');

    expect(app.native.process).toBeDefined();
    expect(typeof app.native.process.spawn).toBe('function');
    expect(typeof app.native.process.exec).toBe('function');
    expect(typeof app.native.process.kill).toBe('function');
    expect(typeof app.native.process.env).toBe('function');
    expect(typeof app.native.process.cwd).toBe('function');

    expect(app.native.db).toBeDefined();
    expect(typeof app.native.db.query).toBe('function');
    expect(typeof app.native.db.exec).toBe('function');

    expect(app.native.keychain).toBeDefined();
    expect(typeof app.native.keychain.get).toBe('function');
    expect(typeof app.native.keychain.set).toBe('function');
    expect(typeof app.native.keychain.delete).toBe('function');
  });

  it('debe validar la superficie de la clase base Plugin', () => {
    const proto = Indexly.Plugin.prototype as any;

    const expectedPluginMethods = [
      'addCommand',
      'addRibbonIcon',
      'addStatusBarItem',
      'addSettingTab',
      'registerView',
      'registerEvent',
      'registerDomEvent',
      'registerInterval',
      'register',
      'loadData',
      'saveData',
    ];

    for (const method of expectedPluginMethods) {
      expect(typeof proto[method], `Plugin.prototype.${method} debe existir`).toBe('function');
    }
  });
});
