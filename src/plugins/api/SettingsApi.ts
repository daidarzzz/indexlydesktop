/**
 * @file src/plugins/api/SettingsApi.ts
 * @description Implementación del módulo `app.settings` para registro de secciones, pestañas y reactividad.
 */

import { EventRef, SettingSection, SettingsApi } from '../types';
import { HostEventsApi } from './EventsApi';
import { ScopedStorageApi } from './StorageApi';

/**
 * Implementación de `app.settings`.
 */
export class HostSettingsApi implements SettingsApi {
  private _events: HostEventsApi;
  private _storage: ScopedStorageApi;
  private _sections: Map<string, SettingSection> = new Map();
  private _tabs: unknown[] = [];
  private _pluginId: string;

  constructor(pluginId: string, events: HostEventsApi, storage?: ScopedStorageApi) {
    this._pluginId = pluginId;
    this._events = events;
    this._storage = storage || new ScopedStorageApi(pluginId);
  }

  public registerSection(section: SettingSection): void {
    if (!section || !section.id) return;
    this._sections.set(section.id, section);
    this._events.emit('settings:section:registered', section);
  }

  public registerTab(tab: unknown): void {
    if (!tab) return;
    this._tabs.push(tab);
    this._events.emit('settings:tab:registered', tab);
  }

  public getSections(): SettingSection[] {
    return Array.from(this._sections.values());
  }

  public getTabs(): unknown[] {
    return [...this._tabs];
  }

  public async get<T = unknown>(key: string, defaultValue?: T): Promise<T> {
    const val = await this._storage.readJson<T>(`setting_${key}`);
    return val !== null && val !== undefined ? val : (defaultValue as T);
  }

  public async set(key: string, value: unknown): Promise<void> {
    await this._storage.writeJson(`setting_${key}`, value);
    this._events.emit(`settings:${this._pluginId}:change`, { key, value });
    this._events.emit('settings:change', { pluginId: this._pluginId, key, value });
  }

  public onChange(
    keyOrCb: string | ((key: string, val: unknown) => void),
    cb?: (val: unknown) => void
  ): EventRef {
    if (typeof keyOrCb === 'function') {
      return this._events.on(`settings:${this._pluginId}:change`, (payload: any) => {
        keyOrCb(payload?.key, payload?.value);
      });
    }

    return this._events.on(`settings:${this._pluginId}:change`, (payload: any) => {
      if (payload && payload.key === keyOrCb && cb) {
        cb(payload.value);
      }
    });
  }
}
