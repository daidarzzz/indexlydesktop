/**
 * @file src/plugins/__tests__/DomainApis.test.ts
 * @description Pruebas unitarias para las APIs de dominio (LibraryApi, SearchApi, WorkspaceApi, SettingsApi, ImporterApi y UI).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HostEventsApi } from '../api/EventsApi';
import { HostLibraryApi } from '../api/LibraryApi';
import { HostSearchApi } from '../api/SearchApi';
import { HostWorkspaceApi } from '../api/WorkspaceApi';
import { HostSettingsApi } from '../api/SettingsApi';
import { HostImporterApi } from '../api/ImporterApi';
import { Menu, SuggestModal } from '../api/ui';
import { App, CustomImporter, SearchProvider, View, WorkspaceLeaf } from '../types';

describe('HostLibraryApi', () => {
  let events: HostEventsApi;
  let library: HostLibraryApi;

  beforeEach(() => {
    events = new HostEventsApi();
    library = new HostLibraryApi(events);
  });

  it('debe agregar, consultar, actualizar y eliminar fuentes emitiendo eventos reactivos', async () => {
    const onAdded = vi.fn();
    const onUpdated = vi.fn();
    const onRemoved = vi.fn();

    library.on('source:added', onAdded);
    library.on('source:updated', onUpdated);
    library.on('source:removed', onRemoved);

    // 1. Agregar
    const source = await library.addSource({
      name: 'Mi Fuente',
      content: JSON.stringify([{ title: 'Juego 1' }]),
    });

    expect(source.name).toBe('Mi Fuente');
    expect(onAdded).toHaveBeenCalledWith(source);

    // 2. Consultar
    const found = await library.getSource(source.id);
    expect(found?.id).toBe(source.id);

    // 3. Actualizar
    const updated = await library.updateSource(source.id, { active: false });
    expect(updated.active).toBe(false);
    expect(onUpdated).toHaveBeenCalledWith(updated);

    // 4. Eliminar
    await library.removeSource(source.id);
    const deleted = await library.getSource(source.id);
    expect(deleted).toBeNull();
    expect(onRemoved).toHaveBeenCalledWith({ id: source.id });
  });
});

describe('HostSearchApi', () => {
  let events: HostEventsApi;
  let search: HostSearchApi;

  beforeEach(() => {
    events = new HostEventsApi();
    search = new HostSearchApi(events);
  });

  it('debe disparar interceptores query:before y query:after', async () => {
    const onBefore = vi.fn();
    const onAfter = vi.fn();

    search.on('query:before', onBefore);
    search.on('query:after', onAfter);

    await search.query('cyberpunk');

    expect(onBefore).toHaveBeenCalled();
    expect(onAfter).toHaveBeenCalled();
  });

  it('debe abortar cooperativamente la búsqueda si signal está abortada', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(search.query('zelda', { signal: controller.signal })).rejects.toThrow(
      'La búsqueda fue cancelada'
    );
  });

  it('debe delegar en un SearchProvider secundario registrado', async () => {
    const mockProvider: SearchProvider = {
      id: 'custom-provider',
      name: 'Proveedor Externo',
      search: vi.fn().mockResolvedValue({
        items: [{ id: '1', source_id: 's1', source_name: 'Ext', title: 'Coincidencia Externa' }],
        total: 1,
        active_sources_count: 1,
        total_items_count: 1,
        took_ms: 5,
      }),
    };

    search.registerProvider(mockProvider);
    const res = await search.query('algo');

    expect(mockProvider.search).toHaveBeenCalledWith('algo', expect.anything());
    expect(res.items[0]?.title).toBe('Coincidencia Externa');

    search.unregisterProvider('custom-provider');
  });

  it('debe detener el streaming asíncrono si signal es abortada', async () => {
    const mockProvider: SearchProvider = {
      id: 'stream-provider',
      name: 'Stream Provider',
      search: vi.fn().mockResolvedValue({
        items: [
          { id: '1', source_id: 's', source_name: 'S', title: 'Item 1' },
          { id: '2', source_id: 's', source_name: 'S', title: 'Item 2' },
          { id: '3', source_id: 's', source_name: 'S', title: 'Item 3' },
        ],
        total: 3,
        active_sources_count: 1,
        total_items_count: 3,
        took_ms: 1,
      }),
    };
    search.registerProvider(mockProvider);

    const controller = new AbortController();
    const hits = [];

    for await (const hit of search.queryStream('test', { signal: controller.signal })) {
      hits.push(hit);
      controller.abort(); // Cancelar tras el primer elemento
    }

    expect(hits).toHaveLength(1);
    expect(hits[0]?.item.title).toBe('Item 1');
  });
});

describe('HostWorkspaceApi', () => {
  let events: HostEventsApi;
  let workspace: HostWorkspaceApi;

  beforeEach(() => {
    events = new HostEventsApi();
    workspace = new HostWorkspaceApi(events);
  });

  it('debe registrar tipos de vista, instanciarlas en hojas y cerrarlas con detach', async () => {
    class CustomTestView extends View {
      getViewType() {
        return 'custom-test';
      }
      getDisplayText() {
        return 'Mi Vista Test';
      }
      getIcon() {
        return 'star';
      }
    }

    workspace.registerViewFactory('custom-test', (leaf: WorkspaceLeaf) => new CustomTestView(leaf));

    const leaf = workspace.getLeaf('custom-test');
    expect(leaf.view).not.toBeNull();
    expect(leaf.view?.getViewType()).toBe('custom-test');

    expect(workspace.getLeaves()).toHaveLength(1);

    workspace.detachLeavesOfType('custom-test');
    expect(workspace.getLeaves()).toHaveLength(0);
  });

  it('debe gestionar el hook onLayoutReady ordenadamente', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    workspace.onLayoutReady(cb1);
    expect(cb1).not.toHaveBeenCalled();

    workspace.markLayoutReady();
    expect(cb1).toHaveBeenCalledTimes(1);

    // Callbacks suscritos tras markLayoutReady se ejecutan de inmediato
    workspace.onLayoutReady(cb2);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

describe('HostSettingsApi', () => {
  let events: HostEventsApi;
  let settings: HostSettingsApi;

  beforeEach(() => {
    events = new HostEventsApi();
    settings = new HostSettingsApi('test-plugin', events);
  });

  it('debe almacenar, leer y notificar cambios de ajustes', async () => {
    const onChange = vi.fn();
    settings.onChange('darkTheme', onChange);

    expect(await settings.get('darkTheme', false)).toBe(false);

    await settings.set('darkTheme', true);
    expect(await settings.get('darkTheme', false)).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('debe registrar y recuperar secciones de ajustes', () => {
    const render = vi.fn();
    settings.registerSection({
      id: 'sec-general',
      name: 'General',
      render,
    });

    expect(settings.getSections()).toHaveLength(1);
    expect(settings.getSections()[0]?.name).toBe('General');
  });
});

describe('HostImporterApi', () => {
  let events: HostEventsApi;
  let importer: HostImporterApi;

  beforeEach(() => {
    events = new HostEventsApi();
    importer = new HostImporterApi(events);
  });

  it('debe registrar importadores personalizados y utilizarlos cuando canHandle es true', async () => {
    const customParser: CustomImporter = {
      id: 'epub-importer',
      name: 'Importador EPUB',
      extensions: ['epub'],
      canHandle: (fn) => fn.endsWith('.epub'),
      parse: vi.fn().mockResolvedValue([
        {
          id: 'epub-src-1',
          name: 'Biblioteca EPUB',
          active: true,
          count: 5,
        },
      ]),
    };

    importer.registerImporter(customParser);

    const sources = await importer.importFile('libro.epub', { filename: 'libro.epub' });
    expect(customParser.parse).toHaveBeenCalled();
    expect(sources[0]?.name).toBe('Biblioteca EPUB');

    importer.unregisterImporter('epub-importer');
  });
});

describe('UI Base Components (Menu y SuggestModal)', () => {
  it('Menu debe crear opciones, separadores y manejar eventos', () => {
    const menu = new Menu();
    const action = vi.fn();

    menu.addItem((item) => {
      item.setTitle('Opción 1');
      item.setIcon('check');
      item.onClick(action);
    });
    menu.addSeparator();

    menu.showAtPosition({ x: 100, y: 150 });
    expect(menu.menuEl.style.display).toBe('block');
    expect(menu.menuEl.style.left).toBe('100px');

    const itemEl = menu.menuEl.querySelector('.indexly-menu-item') as HTMLElement;
    expect(itemEl).not.toBeNull();
    itemEl.click();

    expect(action).toHaveBeenCalled();
    expect(menu.menuEl.style.display).toBe('none');
  });

  it('SuggestModal debe actualizar y filtrar sugerencias dinámicamente', async () => {
    const mockApp = {} as App;
    const chooseAction = vi.fn();

    class TestSuggestModal extends SuggestModal<string> {
      getSuggestions(query: string): string[] {
        const list = ['Apple', 'Banana', 'Orange'];
        return list.filter((i) => i.toLowerCase().includes(query.toLowerCase()));
      }
      renderSuggestion(item: string, el: HTMLElement): void {
        el.textContent = item;
      }
      onChooseSuggestion(item: string): void {
        chooseAction(item);
      }
    }

    const modal = new TestSuggestModal(mockApp);
    modal.open();

    await vi.waitFor(() => expect(modal.suggestionsEl.children.length).toBe(3));

    modal.inputEl.value = 'ban';
    modal.inputEl.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(modal.suggestionsEl.children.length).toBe(1));

    const item = modal.suggestionsEl.children[0] as HTMLElement;
    item.click();

    expect(chooseAction).toHaveBeenCalledWith('Banana');
  });
});
