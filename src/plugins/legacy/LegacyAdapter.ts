/**
 * @file src/plugins/legacy/LegacyAdapter.ts
 * @description Adaptador retrocompatible para emular `window.IndexLy` (v1–v3) sobre la nueva API v1.
 */

import { App } from '../types';

let hasWarnedLegacyRegister = false;
let hasWarnedLegacyPlugin = false;

/**
 * Instala la fachada `window.IndexLy` retrocompatible en el objeto global.
 * @param app Instancia de la API pública del host
 */
export function installLegacyAdapter(app: App): void {
  if (typeof window === 'undefined') return;

  (window as any).IndexLy = {
    apiVersion: 3,

    getSections: () => {
      return (window as any).__indexly_get_sections ? (window as any).__indexly_get_sections() : [];
    },

    register: (def: any) => {
      if (!hasWarnedLegacyRegister) {
        console.warn(
          '[Deprecation Warning] window.IndexLy.register() está deprecado. Las extensiones deben extender de la clase base Plugin de la API v1. Consulte docs/plugin-api/migration.md'
        );
        hasWarnedLegacyRegister = true;
      }
      const pluginId = def.id || (window as any).__current_register_plugin_id || 'unknown';
      if (typeof def.setup === 'function') {
        try {
          def.setup(app.legacy);
        } catch (err) {
          console.error(`[IndexLy Legacy] Error ejecutando setup de '${pluginId}':`, err);
        }
      }
    },

    plugin: (def: any) => {
      if (!hasWarnedLegacyPlugin) {
        console.warn(
          '[Deprecation Warning] window.IndexLy.plugin() está deprecado. Las extensiones deben extender de la clase base Plugin de la API v1. Consulte docs/plugin-api/migration.md'
        );
        hasWarnedLegacyPlugin = true;
      }
      const pluginId = def.id || (window as any).__current_register_plugin_id || 'unknown';
      if (typeof def.activate === 'function') {
        try {
          def.activate(app.legacy);
        } catch (err) {
          console.error(`[IndexLy Legacy] Error en activate de '${pluginId}':`, err);
        }
      } else if (typeof def.setup === 'function') {
        try {
          def.setup(app.legacy);
        } catch (err) {
          console.error(`[IndexLy Legacy] Error en setup de '${pluginId}':`, err);
        }
      }
    },
  };
}
