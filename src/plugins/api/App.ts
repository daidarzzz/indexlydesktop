/**
 * @file src/plugins/api/App.ts
 * @description Construcción de la fachada `App` inyectada a los plugins de IndexLy Desktop (v1).
 */

import {
  App,
  FeatureSet,
  LegacyApi,
  UiApi,
} from '../types';
import { HostEventsApi } from './EventsApi';
import { HostCommandsApi } from './CommandsApi';
import { ScopedStorageApi } from './StorageApi';
import { HostLibraryApi } from './LibraryApi';
import { HostSearchApi } from './SearchApi';
import { HostWorkspaceApi } from './WorkspaceApi';
import { HostSettingsApi } from './SettingsApi';
import { HostImporterApi } from './ImporterApi';
import { createNativeApi } from './NativeApi';
import { HostHubApi } from './HubApi';
import { PluginHost } from '../host/PluginHost';
import { ui as uiKit, mount as mountUi, unmount as unmountUi } from '../../ui';

/**
 * Conjunto de características activadas en el host para detección dinámica.
 */
export class HostFeatureSet implements FeatureSet {
  private _features: Set<string> = new Set([
    'plugin_api_v1',
    'search.fts5',
    'search.streaming',
    'library.v2_envelope',
    'storage.atomic_json',
    'events.namespaced',
    'native.fs',
    'native.process',
    'native.db',
    'native.keychain',
    'workspace.leaves',
    'custom_importers',
  ]);

  public has(feature: string): boolean {
    return this._features.has(feature);
  }

  public list(): readonly string[] {
    return Array.from(this._features);
  }

  public enable(feature: string): void {
    this._features.add(feature);
  }

  public disable(feature: string): void {
    this._features.delete(feature);
  }
}

export const createPublicNativeApi = createNativeApi;

/**
 * Crea una instancia de `App` ligada al contexto del host y opcionalmente a un plugin.
 */
export function createAppInstance(
  pluginId: string = 'host',
  sharedEvents?: HostEventsApi,
  sharedCommands?: HostCommandsApi,
  sharedWorkspace?: HostWorkspaceApi,
  sharedHost?: PluginHost | (() => PluginHost | undefined)
): App {
  const events = sharedEvents || new HostEventsApi();
  const commands = sharedCommands || new HostCommandsApi();
  const workspace = sharedWorkspace || new HostWorkspaceApi(events);
  const storage = new ScopedStorageApi(pluginId);
  const features = new HostFeatureSet();
  const native = createNativeApi();

  const library = new HostLibraryApi(events);
  const search = new HostSearchApi(events);
  const settings = new HostSettingsApi(pluginId, events, storage);
  const importer = new HostImporterApi(events);
  const hub = new HostHubApi(sharedHost);

  const ui: UiApi = {
    getTheme() {
      return 'dark';
    },
    onThemeChange(cb) {
      return events.on('ui:theme_change', cb as (data: any) => void);
    },
    components: uiKit,
    mount: mountUi,
    unmount: unmountUi,
  };

  const legacy: LegacyApi = {
    apiVersion: 3,
  };

  return {
    version: '0.1.0',
    apiVersion: '1.0.0',
    features,
    library,
    search,
    workspace,
    commands,
    settings,
    importer,
    hub,
    native,
    events,
    storage,
    ui,
    legacy,
  };
}
