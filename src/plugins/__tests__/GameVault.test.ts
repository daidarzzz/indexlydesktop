/**
 * @file src/plugins/__tests__/GameVault.test.ts
 * @description Tests del plugin GameVault 1.4.0: compatibilidad web/escritorio,
 * búsqueda en GameDB, deduplicación y render de las vistas principales.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { act, fireEvent } from '@testing-library/react';
import * as uiKit from '../../ui';
import { mount as uiMount, unmount as uiUnmount } from '../../ui/mount';

// En jsdom, import.meta.url no es file://, así que resolvemos desde la raíz del repo.
const pluginPath = resolve(process.cwd(), 'plugins/gamevault/index.js');
const pluginCode = readFileSync(pluginPath, 'utf8');

type AnyCtx = Record<string, any>;

function makeCtx(overrides: AnyCtx = {}) {
  const storage: Record<string, any> = {};
  const sections: any[] = [];
  const handlers: Record<string, Function[]> = {};

  const ctx: AnyCtx = {
    ui: {
      components: uiKit,
      mount: uiMount,
      unmount: uiUnmount,
      React,
    },
    storage: {
      get: async (k: string) => storage[k],
      set: async (k: string, v: any) => { storage[k] = v; },
      remove: async (k: string) => { delete storage[k]; },
    },
    showToast: vi.fn(),
    modal: vi.fn(),
    openLink: vi.fn(),
    copyToClipboard: vi.fn(async () => true),
    escapeHtml: (s: string) => String(s),
    addSection: (s: any) => { sections.push(s); },
    addDocSection: vi.fn(),
    addCardAction: vi.fn(),
    on: (ev: string, fn: Function) => { (handlers[ev] ||= []).push(fn); return () => {}; },
    getIndexes: () => [],
    getItemsBySource: vi.fn(async () => []),
    ...overrides,
  };

  return { ctx, storage, sections, handlers };
}

function loadPlugin() {
  let def: any = null;
  (window as any).__INDEXLY_PLUGIN_TEST__ = true;
  (window as any).React = React;
  (window as any).IndexLy = {
    React,
    ui: {
      components: uiKit,
      mount: uiMount,
      unmount: uiUnmount,
      React,
    },
  };
  // El plugin es un IIFE que se auto-registra vía IndexLy.register().
  new Function('IndexLy', pluginCode)({
    React,
    ui: {
      components: uiKit,
      mount: uiMount,
      unmount: uiUnmount,
      React,
    },
    register: (d: any) => { def = d; },
  });
  return def;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function setup(overrides: AnyCtx = {}) {
  const env = makeCtx(overrides);
  const def = loadPlugin();
  def.setup(env.ctx);
  await flush();
  return { ...env, def, gv: (window as any).__gvTest };
}

function mount(sections: any[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  sections[0].render(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GameVault · capa de datos web/escritorio', () => {
  it('usa ix.games cuando el índice viene de la web', async () => {
    const { gv } = await setup();
    const items = await gv.loadSourceItems({
      id: 'web-1',
      name: 'Web',
      games: [{ title: 'Hollow Knight', link: 'magnet:hk' }],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Hollow Knight', link: 'magnet:hk', sourceName: 'Web' });
  });

  it('usa getItems() cuando el índice viene del escritorio', async () => {
    const { gv } = await setup();
    const getItems = vi.fn(async () => [
      {
        id: 'i1', source_id: 'desk-1', source_name: 'PC', title: 'Elden Ring',
        subtitle: null, file_size: '48 GB', link: 'magnet:er', raw: null,
      },
    ]);

    const items = await gv.loadSourceItems({ id: 'desk-1', name: 'PC', count: 1, getItems });

    expect(getItems).toHaveBeenCalledTimes(1);
    expect(items[0]).toMatchObject({ title: 'Elden Ring', link: 'magnet:er', subtitle: '48 GB', sourceName: 'PC' });
  });

  it('cae a api.getItemsBySource si getItems falla', async () => {
    const { gv } = await setup({
      getItemsBySource: vi.fn(async () => [{ title: 'Celeste', link: 'magnet:c' }]),
    });

    const items = await gv.loadSourceItems({
      id: 'desk-2',
      name: 'Indie',
      count: 1,
      getItems: async () => { throw new Error('boom'); },
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Celeste');
  });

  it('expone el count real antes de cargar los items', async () => {
    const { gv } = await setup();
    expect(gv.sourceCount({ id: 'x', name: 'X', count: 1234 })).toBe(1234);
    expect(gv.sourceCount({ id: 'y', name: 'Y', games: [1, 2, 3] })).toBe(3);
    expect(gv.sourceCount({ id: 'z', name: 'Z' })).toBe(0);
  });

  it('normaliza items de la web y del escritorio', async () => {
    const { gv } = await setup();
    expect(gv.normalizeSourceItem({ name: 'A', url: 'http://a' }, { id: 's', name: 'S' }))
      .toMatchObject({ title: 'A', link: 'http://a', sourceName: 'S' });
    expect(gv.normalizeSourceItem({ titulo: 'B', enlace: 'magnet:b', file_size: '2 GB' }, { id: 's', name: 'S' }))
      .toMatchObject({ title: 'B', link: 'magnet:b', subtitle: '2 GB' });
    expect(gv.normalizeSourceItem(null, { id: 's', name: 'S' })).toBeNull();
  });
});

describe('GameVault · GameDB', () => {
  it('busca con y sin artículo inicial y ordena por relevancia', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.indexOf('buckets/wi.json') >= 0) {
        return {
          ok: true, status: 200,
          json: async () => ({
            '1029': { name: 'The Witcher 3: Wild Hunt' },
            '9999': { name: 'Witcher Tales' },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { gv } = await setup();
    const hits = await gv.gdbSearch('The Witcher 3');

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toBe('The Witcher 3: Wild Hunt');
    // Se han pedido los buckets "th" (con artículo) y "wi" (sin artículo).
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.indexOf('buckets/wi.json') >= 0)).toBe(true);
  });

  it('no cachea buckets que fallan por red', async () => {
    let fail = true;
    const fetchMock = vi.fn(async () => {
      if (fail) throw new Error('network down');
      return {
        ok: true, status: 200,
        json: async () => ({ '42': { name: 'Zelda' } }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { gv } = await setup();
    const first = await gv.gdbSearch('zelda');
    expect(first).toEqual([]);

    fail = false;
    const second = await gv.gdbSearch('zelda');
    expect(second.some((h: any) => h.name === 'Zelda')).toBe(true);
  });

  it('busca franquicias con alias populares resolviendo artículos y prefijos', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.indexOf('buckets/le.json') >= 0) {
        return {
          ok: true, status: 200,
          json: async () => ({
            '1001': { name: 'The Legend of Zelda: Breath of the Wild' },
          }),
        };
      }
      if (url.indexOf('buckets/ze.json') >= 0) {
        return {
          ok: true, status: 200,
          json: async () => ({
            '1002': { name: 'Zelda II: The Adventure of Link' },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { gv } = await setup();
    const hits = await gv.gdbSearch('Zelda');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((h: any) => h.name.includes('Breath of the Wild'))).toBe(true);
    expect(hits.some((h: any) => h.name.includes('Zelda II'))).toBe(true);
  });

  it('mapea una ficha de GameDB al formato de la vault', async () => {
    const { gv } = await setup();
    const mapped = gv.mapGameDB({
      id: 1029,
      name: 'The Witcher 3: Wild Hunt',
      url: 'https://www.igdb.com/games/the-witcher-3-wild-hunt',
      rating: 92,
      aggregated_rating: 93,
      summary: 'Geralt of Rivia...',
      cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/cover.jpg' },
      release_dates: [{ date: 1431993600 }],
      genres: [{ name: 'RPG' }],
      platforms: [6, 48],
      involved_companies: [{ developer: true, company: { name: 'CD Projekt RED' } }],
      screenshots: [{ url: '//images.igdb.com/igdb/image/upload/t_thumb/shot.jpg' }],
    });

    expect(mapped.gdbId).toBe('1029');
    expect(mapped.rating).toBe(4.6);
    expect(mapped.metacritic).toBe(93);
    expect(mapped.developer).toBe('CD Projekt RED');
    expect(mapped.genres).toEqual(['RPG']);
    expect(mapped.coverUrl).toContain('t_cover_big');
    expect(mapped.released).toMatch(/^2015-/);
  });
});

describe('GameVault · auto-match y deduplicación', () => {
  it('limpia años, versiones y repacks del título', async () => {
    const { gv } = await setup();
    expect(gv.cleanTitle('Hollow Knight (2017) v1.5.78 [FitGirl Repack]')).toMatchObject({
      name: 'Hollow Knight',
      year: '2017',
    });
    expect(gv.cleanTitle('Celeste - GOG')).toMatchObject({ name: 'Celeste' });
  });

  it('descarta ya guardados, deduplica por nombre limpio y respeta el límite', async () => {
    const { gv } = await setup();
    gv.setVault([{ id: 'g1', name: 'Hades', status: 'backlog', addedAt: 1, sources: [] }]);
    gv.state.am = { limit: 100, onlyLinks: false, includeExisting: false };

    const out = gv.amatchBuildItems({ id: 's1', name: 'PC' }, [
      { title: 'Hades', link: '' },
      { title: 'Celeste (2018) v1.0', link: 'magnet:c1' },
      { title: 'Celeste', link: 'magnet:c2' },
      { title: 'Hollow Knight', link: '' },
    ]);

    expect(out.map((x: any) => x.clean.name)).toEqual(['Celeste', 'Hollow Knight']);

    gv.state.am = { limit: 1, onlyLinks: false, includeExisting: false };
    const limited = gv.amatchBuildItems({ id: 's2', name: 'PC' }, [
      { title: 'Celeste', link: 'magnet:c1' },
      { title: 'Hollow Knight', link: 'magnet:h1' },
    ]);
    expect(limited).toHaveLength(1);
  });

  it('solo con enlace filtra los elementos sin link', async () => {
    const { gv } = await setup();
    gv.setVault([]);
    gv.state.am = { limit: 100, onlyLinks: true, includeExisting: false };
    const out = gv.amatchBuildItems({ id: 's3', name: 'PC' }, [
      { title: 'Alpha', link: '' },
      { title: 'Beta', link: 'magnet:b' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].clean.name).toBe('Beta');
  });

  it('mergeSource deduplica por enlace', async () => {
    const { gv } = await setup();
    const game: any = { id: 'g', sources: [{ itemLink: 'magnet:a', itemTitle: 'A' }] };

    expect(gv.mergeSource(game, { itemLink: 'magnet:a', itemTitle: 'A' })).toBe(false);
    expect(gv.mergeSource(game, { itemLink: 'magnet:b', itemTitle: 'B' })).toBe(true);
    expect(game.sources).toHaveLength(2);
  });
});

describe('GameVault · vistas', () => {
  const source = () => ({
    id: 'src-1',
    name: 'PC',
    active: true,
    count: 2,
    getItems: async () => [
      { id: 'i1', source_id: 'src-1', source_name: 'PC', title: 'Elden Ring', link: 'magnet:e' },
      { id: 'i2', source_id: 'src-1', source_name: 'PC', title: 'Hades', link: 'magnet:h' },
    ],
  });

  it('el selector de fuentes muestra el count real y lista los elementos', async () => {
    const env = await setup({ getIndexes: () => [source()] });
    env.gv.setVault([{ id: 'g1', name: 'Celeste', status: 'backlog', addedAt: 1, sources: [] }]);
    env.gv.state.view = 'picker';
    env.gv.state.gameId = 'g1';
    env.gv.state.picks = {};
    env.gv.state.pickQuery = '';
    env.gv.state.pickIndexId = null;
    env.gv.state.pickLimit = 150;
    env.gv.state.pickLoading = {};
    env.gv.state.pickErrors = {};

    const host = mount(env.sections);

    await vi.waitFor(() => {
      expect(host.querySelectorAll('[data-pick-key]').length).toBe(2);
    });

    const chips = Array.from(host.querySelectorAll('.gv-chip')).map((c) => c.textContent || '');
    expect(chips.some((t) => t.indexOf('PC') >= 0 && t.indexOf('2') >= 0)).toBe(true);
    expect(host.textContent).toContain('Elden Ring');
  });

  it('auto-match muestra los counts reales en el selector de fuentes', async () => {
    const env = await setup({ getIndexes: () => [source()] });
    env.gv.state.view = 'amatch';
    env.gv.state.am = {
      indexId: null, items: [], running: false, done: false, stopping: false,
      progress: 0, total: 0, limit: 100, onlyLinks: false, includeExisting: false,
    };

    const host = mount(env.sections);
    const options = Array.from(host.querySelectorAll('select option')).map((o) => o.textContent || '');

    expect(options).toContain('PC (2)');
    expect(options.some((t) => t.indexOf('(0)') >= 0)).toBe(false);
  });

  it('la biblioteca vacía muestra un estado vacío útil', async () => {
    const env = await setup();
    env.gv.setVault([]);
    env.gv.state.view = 'library';

    const host = mount(env.sections);
    expect(host.textContent).toContain('Tu vault está vacía');
  });

  it('escanea una fuente, encuentra el juego y lo añade al confirmar', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.indexOf('buckets/el.json') >= 0) {
        return { ok: true, status: 200, json: async () => ({ '1029': { name: 'Elden Ring' } }) };
      }
      if (url.indexOf('games/1029.json') >= 0) {
        return {
          ok: true, status: 200,
          json: async () => ({ id: 1029, name: 'Elden Ring', summary: 'Un soulslike.', genres: [], platforms: [], screenshots: [] }),
        };
      }
      return { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = await setup({
      getIndexes: () => [{
        id: 'src-am', name: 'PC', active: true, count: 1,
        getItems: async () => [{ title: 'Elden Ring', link: 'magnet:e' }],
      }],
    });
    env.gv.setVault([]);
    env.gv.state.view = 'amatch';
    env.gv.state.am = {
      indexId: null, items: [], running: false, done: false, stopping: false,
      progress: 0, total: 0, limit: 100, onlyLinks: false, includeExisting: false,
    };

    const host = mount(env.sections);
    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = 'src-am';
    select.dispatchEvent(new Event('change'));

    const scan = Array.from(host.querySelectorAll('button'))
      .find((b) => (b.textContent || '').indexOf('Escanear') >= 0) as HTMLButtonElement;
    scan.click();

    await vi.waitFor(() => {
      const confirm = host.querySelector('#gv-am-confirm');
      expect(confirm && confirm.textContent).toContain('1 juego');
    });

    (host.querySelector('#gv-am-confirm') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(env.gv.getVault()).toHaveLength(1);
    });
    expect(env.gv.getVault()[0].name).toBe('Elden Ring');
    expect(env.gv.getVault()[0].sources[0].itemLink).toBe('magnet:e');
  });

  it('la barra de búsqueda del catálogo filtra los juegos en tiempo real', async () => {
    const env = await setup();
    env.gv.setVault([
      { id: 'g1', name: 'Celeste', status: 'backlog', addedAt: 1, developer: 'Maddy Makes Games', sources: [] },
      { id: 'g2', name: 'The Witcher 3: Wild Hunt', status: 'playing', addedAt: 2, developer: 'CD Projekt RED', sources: [] },
    ]);
    env.gv.state.view = 'library';
    env.gv.state.libQuery = '';

    const host = mount(env.sections);
    await vi.waitFor(() => {
      expect(host.querySelectorAll('.gv-card').length).toBe(2);
    });

    const searchInput = host.querySelector('input[type="search"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Celeste' } });
    });

    await vi.waitFor(() => {
      const cards = host.querySelectorAll('.gv-card');
      expect(cards.length).toBe(1);
      expect(cards[0].textContent).toContain('Celeste');
    });

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Projekt' } });
    });

    await vi.waitFor(() => {
      const cards = host.querySelectorAll('.gv-card');
      expect(cards.length).toBe(1);
      expect(cards[0].textContent).toContain('The Witcher 3');
    });

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Inexistente' } });
    });

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Nada coincide');
    });
  });

  it('la sección de Buscar juegos consulta GameDB con componentes React y permite añadir a la vault', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.indexOf('buckets/el.json') >= 0) {
        return {
          ok: true, status: 200,
          json: async () => ({ '5555': { name: 'Elden Ring' } }),
        };
      }
      if (url.indexOf('games/5555.json') >= 0) {
        return {
          ok: true, status: 200,
          json: async () => ({
            id: 5555,
            name: 'Elden Ring',
            summary: 'Un gran juego de FromSoftware.',
            genres: [{ name: 'RPG' }],
            platforms: [6],
            cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/er.jpg' },
            involved_companies: [{ developer: true, company: { name: 'FromSoftware' } }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = await setup();
    env.gv.setVault([]);
    env.gv.state.view = 'search';
    env.gv.state.searchQuery = '';

    const host = mount(env.sections);

    await vi.waitFor(() => {
      const input = host.querySelector('input[type="search"]') as HTMLInputElement;
      expect(input).toBeTruthy();
    });

    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Elden Ring' } });
    });

    const searchBtn = Array.from(host.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Buscar')) as HTMLButtonElement;
    if (searchBtn) {
      await act(async () => {
        searchBtn.click();
      });
    }

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Elden Ring');
      expect(host.querySelector('.gv-res-card')).toBeTruthy();
    });

    const addBtn = Array.from(host.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Añadir') as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    await act(async () => {
      addBtn.click();
    });

    await vi.waitFor(() => {
      expect(env.gv.getVault().some((g: any) => g.name === 'Elden Ring')).toBe(true);
    });
    expect(env.ctx.showToast).toHaveBeenCalledWith(expect.stringContaining('Elden Ring'), 'success', undefined);
  });

  it('la vista de detalle muestra las estadísticas en una fila horizontal con formato adecuado', async () => {
    const env = await setup();
    env.gv.setVault([
      {
        id: 'g-worms',
        name: 'Worms Revolution',
        rating: 3.5,
        metacritic: 68,
        released: '2012-10-10',
        pegi: '12',
        status: 'playing',
        addedAt: Date.now(),
        sources: [{ itemTitle: 'Worms.Revolution.v1.0', sourceName: 'PC' }],
      },
    ]);
    env.gv.state.view = 'detail';
    env.gv.state.gameId = 'g-worms';

    const host = mount(env.sections);
    const statsContainer = host.querySelector('.gv-stats') as HTMLElement;
    expect(statsContainer).toBeTruthy();
    expect(statsContainer.style.flexDirection).toBe('row');

    const statItems = host.querySelectorAll('.gv-stat');
    expect(statItems.length).toBe(5); // IGDB, Metacritic, Año, Edad, Fuentes
    expect(host.textContent).toContain('3.5');
    expect(host.textContent).toContain('IGDB');
    expect(host.textContent).toContain('68');
    expect(host.textContent).toContain('Metacritic');
    expect(host.textContent).toContain('2012');
    expect(host.textContent).toContain('PEGI 12');
    expect(host.textContent).toContain('Fuentes');
  });

  it('la barra de controles de auto-match y las filas de candidatos se muestran en fila horizontal (no colapsadas)', async () => {
    const env = await setup({
      getIndexes: () => [{
        id: 'src-1', name: 'SteamRip', count: 2, active: true,
        getItems: async () => [
          { title: 'Worms Revolution', link: 'magnet:w1' },
          { title: 'God of War', link: 'magnet:g1' },
        ],
      }],
    });
    env.gv.state.view = 'amatch';
    env.gv.state.am = {
      indexId: 'src-1', items: [
        {
          domId: 'am-1',
          indexId: 'src-1',
          indexName: 'SteamRip',
          title: 'Worms Revolution',
          clean: { name: 'Worms Revolution', year: '2012' },
          link: 'magnet:w1',
          status: 'found',
          keep: true,
          result: { id: 101, name: 'Worms Revolution' },
          detail: { released: '2012-10-10', rating: 3.5, developer: 'Team17' },
        },
      ],
      running: false, done: false, stopping: false,
      progress: 1, total: 1, limit: 100, onlyLinks: false, includeExisting: false,
    };

    const host = mount(env.sections);
    const toolbar = host.querySelector('.gv-am-toolbar') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.style.flexDirection).toBe('row');

    const candidateRow = host.querySelector('.gv-row') as HTMLElement;
    expect(candidateRow).toBeTruthy();
    expect(candidateRow.style.flexDirection).toBe('row');
    expect(candidateRow.style.minHeight).toBe('64px');
    expect(candidateRow.textContent).toContain('Worms Revolution');
  });

  it('la vista de Añadir fuentes incluye buscador para filtrar elementos y selector para cambiar de juego', async () => {
    const env = await setup({
      getIndexes: () => [{
        id: 'src-1', name: 'SteamRip', count: 3, active: true,
        getItems: async () => [
          { title: 'Worms Revolution Definitive', link: 'magnet:w1' },
          { title: 'God of War Ragnarok', link: 'magnet:g1' },
          { title: 'Hades', link: 'magnet:h1' },
        ],
      }],
    });
    env.gv.setVault([
      { id: 'g-worms', name: 'Worms Revolution', status: 'backlog', addedAt: 1, sources: [] },
      { id: 'g-gow', name: 'God of War', status: 'playing', addedAt: 2, sources: [] },
    ]);
    env.gv.state.gameId = 'g-worms';
    env.gv.openPicker('g-worms');

    expect(env.gv.state.pickQuery).toBe('Worms Revolution');
    expect(env.gv.state.view).toBe('picker');

    const host = mount(env.sections);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Añadir fuentes a los juegos');
    });

    // Debe contener el selector de juego destino (cuando hay más de 1 juego en vault)
    const select = host.querySelector('select[aria-label="Seleccionar juego destino"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('g-worms');

    // Debe haber un buscador de fuentes
    const searchInput = host.querySelector('input[type="search"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    expect(searchInput.value).toBe('Worms Revolution');

    // Cambiar la búsqueda filtra los resultados en tiempo real
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Hades' } });
    });

    await vi.waitFor(() => {
      expect(env.gv.state.pickQuery).toBe('Hades');
    });
  });
});
