/**
 * @file src/plugins/host/PluginLoader.ts
 * @description Cargador y evaluador seguro de bundles CommonJS con sandbox de require y directiva de sourcemap virtual.
 */

import { App, PluginManifest } from '../types';
import { Plugin } from '../api/Plugin';
import { Component } from '../api/Component';
import { Modal, Notice, Setting, PluginSettingTab } from '../api/ui';
import {
  IndexlyError,
  PluginLifecycleError,
  PluginTimeoutError,
  NativeError,
  StorageError,
  ValidationError,
} from '../api/errors';

/**
 * Dependencias y utilidades públicas accesibles mediante `require('indexly')`.
 */
export function createIndexlyPublicPackage(app: App) {
  return {
    app,
    Plugin,
    Component,
    Modal,
    Notice,
    Setting,
    PluginSettingTab,
    IndexlyError,
    PluginLifecycleError,
    PluginTimeoutError,
    NativeError,
    StorageError,
    ValidationError,
  };
}

/**
 * Cargador de plugins CommonJS.
 */
export class PluginLoader {
  /**
   * Carga, evalúa e instancia un plugin a partir de su código JavaScript y manifiesto.
   * @param code Código fuente del bundle en formato CommonJS
   * @param manifest Manifiesto del plugin
   * @param app Instancia de la API del host contextualizada para este plugin
   * @returns Instancia de la clase Plugin lista para ser cargada
   */
  public loadPluginInstance(code: string, manifest: PluginManifest, app: App): Plugin {
    // 1. Preparar el entorno CommonJS
    const moduleObj = { exports: {} as any };
    const exportsObj = moduleObj.exports;

    // 2. Synthetic require con lista de permitidos
    const customRequire = (moduleName: string) => {
      if (moduleName === 'indexly' || moduleName === '@indexly/plugin-api') {
        return createIndexlyPublicPackage(app);
      }

      // Shims seguros para utilidades puras
      if (moduleName === 'path') {
        return {
          join: (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
          dirname: (p: string) => p.substring(0, p.lastIndexOf('/')) || '.',
          basename: (p: string) => p.split('/').pop() || '',
          extname: (p: string) => {
            const b = p.split('/').pop() || '';
            const i = b.lastIndexOf('.');
            return i > 0 ? b.substring(i) : '';
          },
        };
      }

      if (moduleName === 'os') {
        return {
          platform: () => 'win32',
          arch: () => 'x64',
        };
      }

      // Cualquier otra dependencia debe estar empaquetada
      throw new ValidationError(
        `Error en '${manifest.id}': No se puede resolver el módulo '${moduleName}'. Las dependencias externas deben compilarse dentro de main.js. Consulte: docs/plugin-api/DESIGN-RULES.md`,
        manifest.id
      );
    };

    // 3. Añadir la directiva de virtual sourceURL para atribución precisa de errores en stack trace
    const virtualSourceUrl = `\n//# sourceURL=indexly-plugin://${manifest.id}/main.js`;
    const fullCode = code + virtualSourceUrl;

    // 4. Evaluar el código del bundle mediante new Function
    try {
      const runner = new Function('module', 'exports', 'require', fullCode);
      runner(moduleObj, exportsObj, customRequire);
    } catch (err) {
      throw new PluginLifecycleError(
        `Error evaluando el bundle de '${manifest.id}': ${(err as Error).message}`,
        manifest.id,
        err
      );
    }

    // 5. Resolver la clase exportada (soporta module.exports o module.exports.default)
    const ExportedClass = moduleObj.exports?.default || moduleObj.exports;

    if (typeof ExportedClass !== 'function') {
      throw new ValidationError(
        `El plugin '${manifest.id}' no exporta una clase o función constructora válida en main.js`,
        manifest.id
      );
    }

    // 6. Instanciar la clase del plugin
    try {
      const instance = new ExportedClass(app, manifest);
      if (!(instance instanceof Plugin)) {
        // En caso de que no herede directamente pero tenga la forma esperada
        if (typeof (instance as any).onload !== 'function') {
          throw new ValidationError(
            `El plugin '${manifest.id}' exporta una clase que no extiende de 'Plugin' ni implementa 'onload'`,
            manifest.id
          );
        }
      }
      return instance as Plugin;
    } catch (err) {
      throw new PluginLifecycleError(
        `Error instanciando la clase del plugin '${manifest.id}': ${(err as Error).message}`,
        manifest.id,
        err
      );
    }
  }
}

export const pluginLoader = new PluginLoader();
