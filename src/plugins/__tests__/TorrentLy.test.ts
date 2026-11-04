/**
 * @file src/plugins/__tests__/TorrentLy.test.ts
 * @description Tests de TorrentLy 2.0.0: magnet/bencode/.torrent, cliente
 * qBittorrent (login, sync delta, acciones), fuente única del buscador,
 * migración desde 1.3 y vistas principales.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const pluginCode = readFileSync(resolve(process.cwd(), 'plugins/torrently/index.js'), 'utf8');

const HASH = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';

type AnyCtx = Record<string, any>;

let activeDef: any = null;

function loadPlugin() {
  let def: any = null;
  (window as any).__INDEXLY_PLUGIN_TEST__ = true;
  // El plugin es un IIFE que se auto-registra vía IndexLy.plugin().
  new Function('IndexLy', pluginCode)({ plugin: (d: any) => { def = d; } });
  activeDef = def;
  return def;
}

async function flush(times = 24) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function makeCtx(overrides: AnyCtx = {}) {
  const storage: Record<string, any> = {};
  const sections: any[] = [];
  const cardActions: any[] = [];
  const handlers: Record<string, Function[]> = {};
  const disposables: Function[] = [];
  const syncCalls: any[] = [];
  const removeCalls: string[] = [];
  const sourceList: any[] = [];

  const ctx: AnyCtx = {
    storage: {
      get: async (k: string) => storage[k],
      set: async (k: string, v: any) => { storage[k] = v; },
      remove: async (k: string) => { delete storage[k]; },
    },
    showToast: vi.fn(),
    modal: vi.fn(),
    openLink: vi.fn(async () => {}),
    copyToClipboard: vi.fn(async () => true),
    escapeHtml: (s: string) => String(s),
    refreshApp: vi.fn(),
    addSection: (s: any) => { sections.push(s); },
    addDocSection: vi.fn(),
    addCardAction: (a: any) => { cardActions.push(a); },
    on: (ev: string, fn: Function) => {
      (handlers[ev] ||= []).push(fn);
      return () => {
        handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn);
      };
    },
    disposable: (fn: Function) => { disposables.push(fn); },
    sources: {
      list: async () => sourceList,
      getItems: async () => [],
      remove: async (id: string) => { removeCalls.push(id); },
      syncItems: async (input: any) => {
        syncCalls.push(input);
        return {
          id: input.sourceId || 'src-new',
          name: input.name,
          active: true,
          count: (input.items || []).length,
        };
      },
    },
    native: {
      http: {
        request: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
      },
      keychain: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
      },
    },
    ...overrides,
  };

  return { ctx, storage, sections, cardActions, handlers, disposables, syncCalls, removeCalls, sourceList };
}

async function setup(overrides: AnyCtx = {}) {
  const env = makeCtx(overrides);
  const def = loadPlugin();
  def.activate(env.ctx);
  await flush();
  const trly = (window as any).__trlyTest;
  trly.setApi(env.ctx);
  return { ...env, def, trly };
}

function mount(sections: any[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  sections[0].render(host);
  return host;
}

afterEach(() => {
  if (activeDef && typeof activeDef.deactivate === 'function') {
    try { activeDef.deactivate(); } catch { /* nada */ }
  }
  activeDef = null;
  delete (window as any).__trlyTest;
  delete (window as any).__INDEXLY_PLUGIN_TEST__;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Utilidades del propio test
// ---------------------------------------------------------------------------

function hexToBase32(hexStr: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(hexStr, 'hex');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function bencode(value: any): Uint8Array {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from(`${b.length}:`), b]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([Buffer.from(`${value.length}:`), Buffer.from(value)]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  }
  const keys = Object.keys(value).sort();
  const parts: Uint8Array[] = [Buffer.from('d')];
  for (const k of keys) parts.push(bencode(k), bencode(value[k]));
  parts.push(Buffer.from('e'));
  return Buffer.concat(parts);
}

function makeTorrent(info: any, extra: any = {}) {
  const infoBytes = bencode(info);
  const bytes = bencode({ announce: 'udp://tracker.example:80', ...extra, info });
  return { bytes, infoBytes };
}

function qbMock() {
  const calls: any[] = [];
  let rid = 0;

  const http = vi.fn(async (opts: any) => {
    calls.push(opts);
    const url = String(opts.url);
    if (url.endsWith('/api/v2/app/version')) return { status: 200, headers: {}, body: 'v5.2.4' };
    if (url.endsWith('/api/v2/app/webapiVersion')) return { status: 200, headers: {}, body: '2.11.2' };
    if (url.endsWith('/api/v2/auth/login')) {
      return { status: 200, headers: { 'set-cookie': 'SID=abc123; HttpOnly; path=/' }, body: 'Ok.' };
    }
    if (url.includes('/api/v2/sync/maindata')) {
      rid = 42;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          rid,
          full_update: true,
          torrents: {
            [HASH]: {
              name: 'Ubuntu 24.04', progress: 0.5, state: 'downloading', dlspeed: 1024,
              upspeed: 128, num_seeds: 3, num_leechs: 2, eta: 60, size: 1000,
              completed: 500, save_path: 'D:/dl',
            },
          },
          server_state: { dl_info_speed: 1024, free_space_on_disk: 123456 },
        }),
      };
    }
    if (url.endsWith('/api/v2/torrents/add')) return { status: 200, headers: {}, body: 'Ok.' };
    if (url.endsWith('/api/v2/torrents/stop')) return { status: 404, headers: {}, body: '' };
    if (url.endsWith('/api/v2/torrents/pause')) return { status: 200, headers: {}, body: '' };
    if (url.endsWith('/api/v2/torrents/start')) return { status: 404, headers: {}, body: '' };
    if (url.endsWith('/api/v2/torrents/resume')) return { status: 200, headers: {}, body: '' };
    if (url.includes('/api/v2/torrents/files')) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify([{ index: 0, name: 'ubuntu.iso', size: 1000, progress: 0.5, priority: 1 }]),
      };
    }
    if (url.endsWith('/api/v2/torrents/setFilePrio')) return { status: 200, headers: {}, body: '' };
    return { status: 404, headers: {}, body: '' };
  });

  return { calls, http };
}

// ---------------------------------------------------------------------------
// Núcleo: magnets
// ---------------------------------------------------------------------------

describe('TorrentLy · magnets', () => {
  it('parsea btih en hex, nombre, trackers y tamaño', async () => {
    const { trly } = await setup();
    const magnet = `magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=Ubuntu%2024.04&tr=udp%3A%2F%2Fa%3A80&tr=udp%3A%2F%2Fb%3A80&xl=123456`;
    const parsed = trly.parseMagnet(magnet);

    expect(parsed.infoHash).toBe(HASH);
    expect(parsed.name).toBe('Ubuntu 24.04');
    expect(parsed.trackers).toEqual(['udp://a:80', 'udp://b:80']);
    expect(parsed.size).toBe(123456);
  });

  it('acepta btih en base32 y lo normaliza a hex', async () => {
    const { trly } = await setup();
    const b32 = hexToBase32(HASH);
    expect(trly.normalizeBtih(b32)).toBe(HASH);
    expect(trly.parseMagnet(`magnet:?xt=urn:btih:${b32}`).infoHash).toBe(HASH);
  });

  it('soporta btmh (BitTorrent v2)', async () => {
    const { trly } = await setup();
    const v2 = 'ab'.repeat(32);
    const parsed = trly.parseMagnet(`magnet:?xt=urn:btmh:1220${v2}&dn=Hybrid`);
    expect(parsed.v2Hash).toBe(v2);
    expect(parsed.infoHash).toBeNull();
  });

  it('rechaza magnets sin info_hash', async () => {
    const { trly } = await setup();
    expect(trly.parseMagnet('magnet:?dn=SinHash')).toBeNull();
    expect(trly.parseMagnet('https://example.com/a.torrent')).toBeNull();
    expect(trly.parseMagnet(null)).toBeNull();
  });

  it('buildMagnet reconstruye un magnet canónico y estable', async () => {
    const { trly } = await setup();
    const built = trly.buildMagnet({
      infoHash: HASH,
      name: 'Ubuntu 24.04',
      trackers: ['udp://a:80'],
      size: 1000,
    });

    expect(built).toContain(`xt=urn:btih:${HASH}`);
    expect(built).toContain('dn=Ubuntu%2024.04');
    expect(built).toContain('tr=udp%3A%2F%2Fa%3A80');
    expect(built).toContain('xl=1000');

    const reparsed = trly.parseMagnet(built);
    expect(reparsed.infoHash).toBe(HASH);
    expect(reparsed.name).toBe('Ubuntu 24.04');
    expect(reparsed.trackers).toEqual(['udp://a:80']);
  });

  it('magnetKey prioriza el info_hash', async () => {
    const { trly } = await setup();
    expect(trly.magnetKey(`magnet:?xt=urn:btih:${HASH}&dn=A`)).toBe(HASH);
    expect(trly.magnetKey(`magnet:?xt=urn:btih:${HASH}&dn=B`)).toBe(HASH);
  });
});

// ---------------------------------------------------------------------------
// Núcleo: bencode y .torrent
// ---------------------------------------------------------------------------

describe('TorrentLy · bencode y .torrent', () => {
  it('decodifica diccionarios, listas, enteros y cadenas', async () => {
    const { trly } = await setup();
    const decoded = trly.decodeBencode(bencode({ a: 1, b: ['x', 2], c: { d: 'e' } }));
    expect(decoded.value).toEqual({ a: 1, b: ['x', 2], c: { d: 'e' } });
  });

  it('extrae metadatos e info_hash SHA-1 de un torrent de un solo archivo', async () => {
    const { trly } = await setup();
    const info = { name: 'ubuntu.iso', length: 1024, 'piece length': 16384, pieces: new Uint8Array(20) };
    const { bytes, infoBytes } = makeTorrent(info);
    const expected = createHash('sha1').update(infoBytes).digest('hex');

    const meta = await trly.parseTorrentFile(bytes, 'ubuntu.torrent');

    expect(meta.name).toBe('ubuntu.iso');
    expect(meta.infoHash).toBe(expected);
    expect(meta.totalSize).toBe(1024);
    expect(meta.fileCount).toBe(1);
    expect(meta.magnet).toContain(`xt=urn:btih:${expected}`);
  });

  it('suma los archivos de un torrent multiarchivo', async () => {
    const { trly } = await setup();
    const info = {
      name: 'Pack',
      'piece length': 16384,
      pieces: new Uint8Array(20),
      files: [
        { length: 100, path: ['a.txt'] },
        { length: 200, path: ['sub', 'b.txt'] },
      ],
    };
    const { bytes } = makeTorrent(info);

    const meta = await trly.parseTorrentFile(bytes, 'pack.torrent');
    expect(meta.fileCount).toBe(2);
    expect(meta.totalSize).toBe(300);
    expect(meta.files.map((f: any) => f.path)).toEqual(['a.txt', 'sub/b.txt']);
  });

  it('calcula también el hash v2 en torrents híbridos', async () => {
    const { trly } = await setup();
    const info = {
      name: 'hybrid.bin',
      length: 10,
      'meta version': 2,
      'piece length': 16384,
      pieces: new Uint8Array(20),
    };
    const { bytes, infoBytes } = makeTorrent(info);
    const v1 = createHash('sha1').update(infoBytes).digest('hex');
    const v2 = createHash('sha256').update(infoBytes).digest('hex');

    const meta = await trly.parseTorrentFile(bytes, 'hybrid.torrent');
    expect(meta.infoHash).toBe(v1);
    expect(meta.v2Hash).toBe(v2);
    expect(meta.magnet).toContain(`urn:btmh:1220${v2}`);
  });

  it('rechaza archivos que no son torrents', async () => {
    const { trly } = await setup();
    await expect(trly.parseTorrentFile(bencode({ announce: 'x' }), 'x.torrent')).rejects.toThrow(/no es un \.torrent/i);
  });

  it('no arrastra el borrado automático de fuentes de 1.3', () => {
    expect(pluginCode).not.toContain('cleanCorruptedSources');
    expect(pluginCode).not.toContain('Math.random');
  });
});

// ---------------------------------------------------------------------------
// Motor: cliente qBittorrent
// ---------------------------------------------------------------------------

describe('TorrentLy · cliente qBittorrent', () => {
  it('detecta la versión y expone webapiVersion', async () => {
    const { trly } = await setup();
    const { http } = qbMock();
    const client = trly.createQbClient({ baseUrl: '127.0.0.1', username: 'admin', password: 'pw', http });

    const info = await client.probe();
    expect(info.available).toBe(true);
    expect(info.authRequired).toBe(false);
    expect(client.getVersion()).toBe('v5.2.4');
    expect(client.getWebapiVersion()).toBe('2.11.2');
  });

  it('hace login por formulario y reutiliza la cookie SID', async () => {
    const { trly } = await setup();
    const { http, calls } = qbMock();
    const client = trly.createQbClient({ baseUrl: 'http://127.0.0.1:8080', username: 'admin', password: 'p@ss', http });

    await client.login();
    const login = calls.find((c) => String(c.url).endsWith('/auth/login'));
    expect(login.body).toContain('username=admin');
    expect(login.body).toContain('password=p%40ss');
    expect(login.headers['Content-Type']).toContain('application/x-www-form-urlencoded');

    await client.sync(0);
    const sync = calls.find((c) => String(c.url).includes('/sync/maindata'));
    expect(sync.headers.Cookie).toBe('SID=abc123');
    expect(sync.url).toContain('rid=0');
  });

  it('interpreta el sync delta con torrents y server_state', async () => {
    const { trly } = await setup();
    const { http } = qbMock();
    const client = trly.createQbClient({ baseUrl: 'http://127.0.0.1:8080', username: 'a', password: 'b', http });

    const data = await client.sync(0);
    expect(data.rid).toBe(42);
    expect(data.torrents[HASH].progress).toBe(0.5);
    expect(data.server_state.dl_info_speed).toBe(1024);
  });

  it('añade magnets con savepath y estado de pausa', async () => {
    const { trly } = await setup();
    const { http, calls } = qbMock();
    const client = trly.createQbClient({ baseUrl: 'http://127.0.0.1:8080', username: 'a', password: 'b', http });

    await client.add(`magnet:?xt=urn:btih:${HASH}`, { savePath: 'D:/dl', paused: true });
    const add = calls.find((c) => String(c.url).endsWith('/torrents/add'));
    expect(add.body).toContain('urls=magnet%3A%3Fxt%3Durn%3Abtih%3A' + HASH);
    expect(add.body).toContain('savepath=D%3A%2Fdl');
    expect(add.body).toContain('paused=true');
  });

  it('usa stop/start en qBittorrent 5.x y cae a pause/resume si no existen', async () => {
    const { trly } = await setup();
    const { http, calls } = qbMock();
    const client = trly.createQbClient({ baseUrl: 'http://127.0.0.1:8080', username: 'a', password: 'b', http });

    await client.setPaused(HASH, true);
    expect(calls.some((c) => String(c.url).endsWith('/torrents/stop'))).toBe(true);
    expect(calls.some((c) => String(c.url).endsWith('/torrents/pause'))).toBe(true);

    await client.setPaused(HASH, false);
    expect(calls.some((c) => String(c.url).endsWith('/torrents/start'))).toBe(true);
    expect(calls.some((c) => String(c.url).endsWith('/torrents/resume'))).toBe(true);
  });

  it('lista archivos y aplica prioridades', async () => {
    const { trly } = await setup();
    const { http, calls } = qbMock();
    const client = trly.createQbClient({ baseUrl: 'http://127.0.0.1:8080', username: 'a', password: 'b', http });

    const files = await client.files(HASH);
    expect(files[0].name).toBe('ubuntu.iso');

    await client.setFilePriority(HASH, [0, 1], 0);
    const prio = calls.find((c) => String(c.url).endsWith('/setFilePrio'));
    expect(prio.body).toContain('hash=' + HASH);
    expect(prio.body).toContain('id=0%7C1');
    expect(prio.body).toContain('priority=0');
  });

  it('detecta que hace falta autenticación y rechaza credenciales inválidas', async () => {
    const { trly } = await setup();

    const http403 = vi.fn(async () => ({ status: 403, headers: {}, body: '' }));
    const needAuth = trly.createQbClient({ baseUrl: 'http://127.0.0.1:8080', http: http403 });
    expect((await needAuth.probe()).authRequired).toBe(true);
    await expect(needAuth.login()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    const httpFail = vi.fn(async (opts: any) => (
      String(opts.url).endsWith('/auth/login')
        ? { status: 200, headers: {}, body: 'Fails.' }
        : { status: 403, headers: {}, body: '' }
    ));
    const bad = trly.createQbClient({ baseUrl: 'http://127.0.0.1:8080', username: 'a', password: 'b', http: httpFail });
    await expect(bad.login()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('normaliza la URL de la Web UI', async () => {
    const { trly } = await setup();
    expect(trly.normalizeQbUrl('127.0.0.1')).toBe('http://127.0.0.1:8080');
    expect(trly.normalizeQbUrl('http://localhost:9090/')).toBe('http://localhost:9090');
    expect(trly.normalizeQbUrl('https://qb.example.com')).toBe('https://qb.example.com');
  });
});

// ---------------------------------------------------------------------------
// Fuente única del buscador
// ---------------------------------------------------------------------------

describe('TorrentLy · fuente única «🧲 Torrents»', () => {
  it('genera un item por torrent con id estable y metadatos', async () => {
    const { trly } = await setup();
    const items = trly.buildSourceItems([
      {
        id: HASH, infoHash: HASH, name: 'Ubuntu 24.04',
        magnet: `magnet:?xt=urn:btih:${HASH}&dn=Ubuntu`,
        totalSize: 1024 * 1024 * 1024, fileCount: 2,
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('tr-' + HASH);
    expect(items[0].source_name).toBe('🧲 Torrents');
    expect(items[0].title).toBe('Ubuntu 24.04');
    expect(items[0].subtitle).toContain('2 archivos');
    expect(items[0].file_size_bytes).toBe(1024 * 1024 * 1024);
    expect(items[0].link).toContain(`btih:${HASH}`);
  });

  it('deduplica por info_hash y omite entradas sin magnet', async () => {
    const { trly } = await setup();
    const items = trly.buildSourceItems([
      { id: HASH, infoHash: HASH, name: 'A', magnet: `magnet:?xt=urn:btih:${HASH}`, totalSize: 1 },
      { id: HASH, infoHash: HASH, name: 'B', magnet: `magnet:?xt=urn:btih:${HASH}&dn=B`, totalSize: 1 },
      { id: 'sin-magnet', infoHash: '', name: 'C', magnet: '', totalSize: 0 },
    ]);
    expect(items).toHaveLength(1);
  });

  it('crea o actualiza la fuente con syncItems cuando el buscador está activo', async () => {
    const { trly, syncCalls } = await setup();
    trly.setState({
      torrents: [{ infoHash: HASH, name: 'Ubuntu', magnet: `magnet:?xt=urn:btih:${HASH}`, totalSize: 1000 }],
      settings: { showInSearch: true },
      sourceId: null,
    });

    await trly.syncSource();

    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].name).toBe('🧲 Torrents');
    expect(syncCalls[0].items).toHaveLength(1);
    expect(syncCalls[0].flags).toMatchObject({ isTorrentSource: true, managedByPlugin: true });
    expect(trly.getState().sourceId).toBe('src-new');
  });

  it('elimina la fuente cuando el buscador se desactiva o la biblioteca queda vacía', async () => {
    const { trly, removeCalls } = await setup();
    trly.setState({
      torrents: [{ infoHash: HASH, name: 'Ubuntu', magnet: `magnet:?xt=urn:btih:${HASH}` }],
      settings: { showInSearch: false },
      sourceId: 'src-viejo',
    });

    await trly.syncSource();
    expect(removeCalls).toContain('src-viejo');
    expect(trly.getState().sourceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Biblioteca y migración
// ---------------------------------------------------------------------------

describe('TorrentLy · biblioteca y migración', () => {
  it('deduplica al añadir y permite eliminar', async () => {
    const { trly } = await setup();
    trly.setState({ torrents: [] });

    const first = trly.addToLibrary({ infoHash: HASH, name: 'A', magnet: `magnet:?xt=urn:btih:${HASH}` });
    const second = trly.addToLibrary({ infoHash: HASH, name: 'B', magnet: `magnet:?xt=urn:btih:${HASH}` });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(trly.getState().torrents).toHaveLength(1);

    trly.removeFromLibrary(first.entry.id);
    expect(trly.getState().torrents).toHaveLength(0);
  });

  it('migra v3 descartando el progreso falso y deduplicando', async () => {
    const { trly } = await setup();
    const migrated = trly.migrateV3({
      torrents: [
        {
          infoHash: HASH, name: 'Viejo', magnet: `magnet:?xt=urn:btih:${HASH}`,
          totalSize: 500, createdAt: 123, files: [{}, {}],
          download: { progress: 0.99, speed: 123, peers: 9 },
        },
        { infoHash: HASH, name: 'Duplicado', magnet: `magnet:?xt=urn:btih:${HASH}` },
      ],
      settings: { default_mode: 'internal', download_dir: 'D:/Torrents', clean_corrupted: true },
    });

    expect(migrated.torrents).toHaveLength(1);
    expect(migrated.torrents[0]).toMatchObject({ name: 'Viejo', engine: 'external', fileCount: 2 });
    expect(migrated.torrents[0]).not.toHaveProperty('download');
    expect(migrated.settings.mode).toBe('auto');
    expect(migrated.settings.savePath).toBe('D:/Torrents');
  });

  it('normaliza entradas sin id usando el magnet', async () => {
    const { trly } = await setup();
    const entry = trly.normalizeEntry({ name: 'X', magnet: `magnet:?xt=urn:btih:${HASH}` });
    expect(entry.id).toBe(HASH);
    expect(entry.infoHash).toBe(HASH);
  });
});

// ---------------------------------------------------------------------------
// Flujo de añadir: qBittorrent y fallback externo
// ---------------------------------------------------------------------------

describe('TorrentLy · añadir torrents', () => {
  it('sin qBittorrent abre el magnet en el cliente del sistema', async () => {
    const { trly, ctx, syncCalls } = await setup();
    trly.setState({ torrents: [], settings: { showInSearch: true } });

    const res = await trly.addTorrentInput(`magnet:?xt=urn:btih:${HASH}&dn=Ubuntu`, { source: 'test' });

    expect(res.added).toBe(1);
    expect(ctx.openLink).toHaveBeenCalledWith(expect.stringContaining(`btih:${HASH}`));
    expect(trly.getState().torrents).toHaveLength(1);
    expect(syncCalls[syncCalls.length - 1].items).toHaveLength(1);
  });

  it('con qBittorrent conectado lo añade sin abrir el cliente externo', async () => {
    const { trly, ctx } = await setup();
    trly.setState({ torrents: [] });

    const add = vi.fn(async () => {});
    trly.setEngine({ status: 'connected', kind: 'qbittorrent', client: { add } });

    const res = await trly.addTorrentInput(`magnet:?xt=urn:btih:${HASH}&dn=Ubuntu`, { source: 'test' });

    expect(res.added).toBe(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(ctx.openLink).not.toHaveBeenCalled();
  });

  it('si qBittorrent falla, cae al cliente externo sin perder el torrent', async () => {
    const { trly, ctx } = await setup();
    trly.setState({ torrents: [] });

    const add = vi.fn(async () => { throw new Error('boom'); });
    trly.setEngine({ status: 'connected', kind: 'qbittorrent', client: { add } });

    const res = await trly.addTorrentInput(`magnet:?xt=urn:btih:${HASH}`, { source: 'test' });

    expect(res.added).toBe(1);
    expect(ctx.openLink).toHaveBeenCalled();
    expect(trly.getState().torrents[0].lastError).toBe('boom');
  });

  it('detecta duplicados por info_hash', async () => {
    const { trly } = await setup();
    trly.setState({ torrents: [] });

    await trly.addTorrentInput(`magnet:?xt=urn:btih:${HASH}`, {});
    const res = await trly.addTorrentInput(`magnet:?xt=urn:btih:${HASH}&dn=Otro`, {});

    expect(res.added).toBe(0);
    expect(res.duplicates).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

describe('TorrentLy · vistas', () => {
  it('muestra el estado vacío sin progreso inventado', async () => {
    const { sections, trly } = await setup();
    trly.setState({ torrents: [], loaded: true });
    const host = mount(sections);

    expect(host.textContent).toContain('Tu biblioteca de torrents está vacía');
    expect(host.textContent).toContain('Añadir magnet');
    expect(host.textContent).not.toContain('100 %');
  });

  it('lista torrents con acciones y sin barra si es externo', async () => {
    const { sections, trly } = await setup();
    trly.setState({
      torrents: [{
        infoHash: HASH, name: 'Ubuntu 24.04',
        magnet: `magnet:?xt=urn:btih:${HASH}`, totalSize: 1024, fileCount: 2,
      }],
      loaded: true,
    });

    const host = mount(sections);
    expect(host.textContent).toContain('Ubuntu 24.04');
    expect(host.textContent).toContain('Detalles');
    expect(host.textContent).toContain('Abrir');
    expect(host.querySelector('.trly-bar')).toBeNull();
  });

  it('muestra progreso real cuando qBittorrent está conectado', async () => {
    const { sections, trly } = await setup();
    trly.setState({
      torrents: [{
        infoHash: HASH, name: 'Ubuntu 24.04',
        magnet: `magnet:?xt=urn:btih:${HASH}`, totalSize: 1000,
      }],
      loaded: true,
    });
    trly.setEngine({ status: 'connected', kind: 'qbittorrent' });
    trly.setLive({ [HASH]: { progress: 0.42, state: 'downloading', dlspeed: 1024, num_seeds: 3, num_leechs: 2, eta: 60 } });

    const host = mount(sections);
    expect(host.querySelector('.trly-bar')).not.toBeNull();
    expect(host.textContent).toContain('42,0 %');
    expect(host.textContent).toContain('Descargando');
  });

  it('abre ajustes y muestra el motor y la sección opcional de qBittorrent', async () => {
    const { sections, trly } = await setup();
    trly.setState({ torrents: [], loaded: true });
    const host = mount(sections);

    (host.querySelector('[data-trly-act="settings"]') as HTMLElement).click();

    expect(host.textContent).toContain('Motor de descargas');
    expect(host.textContent).toContain('qBittorrent (opcional)');
    expect(host.textContent).toContain('No hay configuración obligatoria');
  });

  it('abre el modal de añadir y se cierra con Escape', async () => {
    const { sections, trly } = await setup();
    trly.setState({ torrents: [], loaded: true });
    const host = mount(sections);

    (host.querySelector('[data-trly-act="add"]') as HTMLElement).click();
    expect(document.getElementById('trly-modal')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('trly-modal')).toBeNull();
  });

  it('pinta el badge «En TorrentLy» en las tarjetas del buscador', async () => {
    const { handlers, trly } = await setup();
    trly.setState({
      torrents: [{ infoHash: HASH, name: 'Ubuntu', magnet: `magnet:?xt=urn:btih:${HASH}` }],
    });

    const card = document.createElement('div');
    const info = document.createElement('div');
    info.className = 'game-info-container';
    card.appendChild(info);

    handlers['items:hydrate'][0]({
      el: card,
      game: { link: `magnet:?xt=urn:btih:${HASH}`, title: 'Ubuntu' },
    });

    expect(card.querySelector('.trly-badge')).not.toBeNull();
    expect(card.textContent).toContain('En TorrentLy');
  });

  it('pegar un magnet fuera de un input lo añade', async () => {
    const { trly, ctx } = await setup();
    trly.setState({ torrents: [] });

    const ev = new Event('paste', { bubbles: true }) as any;
    ev.clipboardData = { getData: () => `magnet:?xt=urn:btih:${HASH}&dn=Ubuntu` };
    window.dispatchEvent(ev);
    await flush();

    expect(ctx.openLink).toHaveBeenCalledWith(expect.stringContaining(`btih:${HASH}`));
  });

  it('no secuestra el pegado dentro de un input', async () => {
    const { trly, ctx } = await setup();
    trly.setState({ torrents: [] });

    const input = document.createElement('input');
    document.body.appendChild(input);
    const ev = new Event('paste', { bubbles: true }) as any;
    ev.clipboardData = { getData: () => `magnet:?xt=urn:btih:${HASH}` };
    input.dispatchEvent(ev);
    await flush();

    expect(ctx.openLink).not.toHaveBeenCalled();
  });

  it('guarda ajustes y la contraseña en el llavero', async () => {
    const { sections, trly, ctx } = await setup();
    trly.setState({ torrents: [], loaded: true });
    trly.getState().ui.view = 'settings';
    const host = mount(sections);

    (host.querySelector('#trly-qb-url') as HTMLInputElement).value = 'http://127.0.0.1:9090';
    (host.querySelector('#trly-qb-user') as HTMLInputElement).value = 'admin';
    (host.querySelector('#trly-qb-pass') as HTMLInputElement).value = 'secreto';
    (host.querySelector('[data-trly-act="save-settings"]') as HTMLElement).click();
    await flush();

    expect(trly.getState().settings.qbUrl).toBe('http://127.0.0.1:9090');
    expect(trly.getState().settings.qbUsername).toBe('admin');
    expect(ctx.native.keychain.set).toHaveBeenCalledWith('torrently.qb.password', 'secreto');
  });

  it('la acción de tarjeta solo aparece para magnets', async () => {
    const { cardActions } = await setup();
    const action = cardActions[0];
    expect(action.label).toContain('TorrentLy');
    expect(action.match({ link: `magnet:?xt=urn:btih:${HASH}` })).toBe(true);
    expect(action.match({ link: 'https://example.com/a.torrent' })).toBe(false);
    expect(action.match({ link: '' })).toBe(false);
  });
});
