/**
 * @file src/plugins/__tests__/CommandsEventsStorage.test.ts
 * @description Pruebas unitarias para EventsApi, CommandsApi y StorageApi.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HostEventsApi } from '../api/EventsApi';
import { HostCommandsApi } from '../api/CommandsApi';
import { ScopedStorageApi } from '../api/StorageApi';

describe('HostEventsApi', () => {
  let events: HostEventsApi;

  beforeEach(() => {
    events = new HostEventsApi();
  });

  it('debe registrar y emitir eventos correctamente', () => {
    const handler = vi.fn();
    const ref = events.on('source:added', handler);

    expect(ref.id).toBeDefined();
    expect(ref.event).toBe('source:added');

    events.emit('source:added', { id: 'src-1' });
    expect(handler).toHaveBeenCalledWith({ id: 'src-1' });
  });

  it('debe desuscribir un evento con off()', () => {
    const handler = vi.fn();
    const ref = events.on('test:event', handler);

    events.emit('test:event', 'primer envío');
    expect(handler).toHaveBeenCalledTimes(1);

    events.off(ref);
    events.emit('test:event', 'segundo envío');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('debe purgar todos los eventos de un plugin específico', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    events.on('shared:event', h1, 'plugin-a');
    events.on('shared:event', h2, 'plugin-b');

    events.purgePlugin('plugin-a');
    events.emit('shared:event', 'hola');

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith('hola');
  });

  it('no debe fallar si un listener arroja una excepción', () => {
    const badHandler = vi.fn().mockImplementation(() => {
      throw new Error('Explosión en listener');
    });
    const goodHandler = vi.fn();

    events.on('data:ready', badHandler);
    events.on('data:ready', goodHandler);

    expect(() => events.emit('data:ready', { ok: true })).not.toThrow();
    expect(goodHandler).toHaveBeenCalledWith({ ok: true });
  });
});

describe('HostCommandsApi', () => {
  let commands: HostCommandsApi;

  beforeEach(() => {
    commands = new HostCommandsApi();
  });

  it('debe registrar, listar y ejecutar comandos', async () => {
    const callback = vi.fn();
    commands.addCommand({
      id: 'cmd-test',
      name: 'Comando de Prueba',
      callback,
    });

    expect(commands.listCommands()).toHaveLength(1);
    expect(commands.listCommands()[0]?.id).toBe('cmd-test');

    const result = await commands.executeCommand('cmd-test');
    expect(result).toBe(true);
    expect(callback).toHaveBeenCalled();
  });

  it('debe respetar checkCallback para disponibilidad', async () => {
    const checkCb = vi.fn().mockReturnValue(false);
    commands.addCommand({
      id: 'cmd-disabled',
      name: 'Comando Desactivado',
      checkCallback: checkCb,
    });

    const res = await commands.executeCommand('cmd-disabled');
    expect(res).toBe(false);
    expect(checkCb).toHaveBeenCalledWith(true);
  });

  it('debe eliminar comandos con removeCommand()', async () => {
    commands.addCommand({
      id: 'cmd-remove',
      name: 'Eliminarme',
      callback: () => {},
    });

    expect(commands.listCommands()).toHaveLength(1);
    commands.removeCommand('cmd-remove');
    expect(commands.listCommands()).toHaveLength(0);

    const executed = await commands.executeCommand('cmd-remove');
    expect(executed).toBe(false);
  });
});

describe('ScopedStorageApi', () => {
  let storage: ScopedStorageApi;

  beforeEach(() => {
    storage = new ScopedStorageApi('test-plugin');
  });

  it('debe escribir y leer datos JSON de forma aislada', async () => {
    const config = { theme: 'dark', refreshRate: 30 };
    await storage.writeJson('data.json', config);

    const read = await storage.readJson<{ theme: string; refreshRate: number }>('data.json');
    expect(read).toEqual(config);
  });

  it('debe devolver null si el archivo no existe', async () => {
    const result = await storage.readJson('inexistente.json');
    expect(result).toBeNull();
  });

  it('debe eliminar archivos con remove()', async () => {
    await storage.writeText('temporal.txt', 'contenido');
    const read1 = await storage.readText('temporal.txt');
    expect(read1).toBe('contenido');

    await storage.remove('temporal.txt');
    const read2 = await storage.readJson('temporal.txt');
    expect(read2).toBeNull();
  });
});
