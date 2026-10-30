/**
 * @file src/plugins/__tests__/HubManifest.test.ts
 * @description Suite de pruebas para validación de manifiestos, grandfathering, cálculo de diff de permisos y HubApi.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculatePermissionDiff, validateAndNormalizeManifest } from '../manifest/validator';
import { ValidationError } from '../api/errors';
import { HostHubApi } from '../api/HubApi';
import { PluginHost } from '../host/PluginHost';
import { HostEventsApi } from '../api/EventsApi';
import { HostCommandsApi } from '../api/CommandsApi';
import { HostWorkspaceApi } from '../api/WorkspaceApi';

describe('Manifest v1 Validator & Grandfathering', () => {
  it('debe validar y normalizar un manifiesto v1 completo', () => {
    const raw = {
      id: 'com.acme.super-reader',
      name: 'Super Reader',
      version: '1.2.0',
      minHostVersion: '0.1.0',
      description: 'Lector de libros',
      author: 'Acme Corp',
      permissions: ['fs:read', 'workspace.views'],
      hash: 'sha256-abc123',
    };

    const manifest = validateAndNormalizeManifest(raw);
    expect(manifest.id).toBe('com.acme.super-reader');
    expect(manifest.version).toBe('1.2.0');
    expect(manifest.permissions).toEqual(['fs:read', 'workspace.views']);
  });

  it('debe aplicar grandfathering a plugins legacy incorporados (sin notación de dominio)', () => {
    const legacyPlugins = ['vistas', 'readly', 'spotlight'];

    for (const legId of legacyPlugins) {
      const manifest = validateAndNormalizeManifest({
        id: legId,
        name: legId.toUpperCase(),
        version: '1.0',
      });

      expect(manifest.id).toBe(legId);
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.minHostVersion).toBe('0.1.0');
    }
  });

  it('debe rechazar manifiestos de terceros modernos que no sigan dominio inverso', () => {
    expect(() =>
      validateAndNormalizeManifest({
        id: 'bad id without domain',
        name: 'Bad Plugin',
      })
    ).toThrow(ValidationError);
  });
});

describe('Permission Diff Calculator', () => {
  it('debe detectar correctamente la elevación de permisos (permisos añadidos)', () => {
    const oldPerms = ['fs:read'];
    const newPerms = ['fs:read', 'network', 'db:write'];

    const diff = calculatePermissionDiff(oldPerms, newPerms);
    expect(diff.hasElevation).toBe(true);
    expect(diff.added).toEqual(['network', 'db:write']);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual(['fs:read']);
  });

  it('debe detectar eliminación de permisos sin elevación', () => {
    const oldPerms = ['fs:read', 'network'];
    const newPerms = ['fs:read'];

    const diff = calculatePermissionDiff(oldPerms, newPerms);
    expect(diff.hasElevation).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['network']);
    expect(diff.unchanged).toEqual(['fs:read']);
  });
});

describe('HostHubApi', () => {
  let events: HostEventsApi;
  let commands: HostCommandsApi;
  let workspace: HostWorkspaceApi;
  let host: PluginHost;
  let hub: HostHubApi;

  beforeEach(() => {
    events = new HostEventsApi();
    commands = new HostCommandsApi();
    workspace = new HostWorkspaceApi(events);
    host = new PluginHost(events, commands, workspace);
    hub = new HostHubApi(host);
  });

  it('debe buscar y devolver plugins del catálogo', async () => {
    const all = await hub.search('');
    expect(all.length).toBeGreaterThan(0);

    const filtered = await hub.search('csv');
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('com.indexly.csv-importer');
  });

  it('debe obtener detalles completos de un plugin', async () => {
    const detail = await hub.getPlugin('com.indexly.csv-importer');
    expect(detail).not.toBeNull();
    expect(detail?.permissions).toContain('fs:read');
    expect(detail?.hash).toBeDefined();
  });

  it('debe instalar y desinstalar plugins a través del ciclo de vida del host', async () => {
    await hub.install('com.indexly.csv-importer');

    const installed = hub.listInstalled();
    const found = installed.find((p) => p.manifest.id === 'com.indexly.csv-importer');
    expect(found).toBeDefined();

    // Desinstalar
    const uninstalledListener = vi.fn();
    events.on('plugin:uninstalled', uninstalledListener);

    await hub.uninstall('com.indexly.csv-importer');
    expect(uninstalledListener).toHaveBeenCalledWith({ id: 'com.indexly.csv-importer' });
  });

  it('debe permitir recargar en caliente un plugin (Dev Mode)', async () => {
    await hub.install('com.indexly.csv-importer');
    expect(host.isPluginLoaded('com.indexly.csv-importer')).toBe(true);

    const reloaded = await host.reloadPlugin('com.indexly.csv-importer');
    expect(reloaded).toBe(true);
    expect(host.isPluginLoaded('com.indexly.csv-importer')).toBe(true);
  });
});
