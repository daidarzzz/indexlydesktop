/* IndexLy Plugin
   id: gamevault
   name: GameVault
   version: 1.4.0
   description: Tu colección de juegos: busca en GameDB (datos de IGDB publicados por LizardByte, sin claves ni configuración), guarda juegos con carátulas y ficha completa, y asígnales fuentes de descarga desde tus propios índices. Auto-match, estadísticas, backup y añadido manual.
   permissions: network, ui, storage
*/
(function () {
  var api = null;
  var pageRoot = null;
  var gamesCache = null;

  var React = (typeof IndexLy !== "undefined" && (IndexLy.React || (IndexLy.ui && IndexLy.ui.React))) ||
              (typeof window !== "undefined" && (window.React || (window.IndexLy && (window.IndexLy.React || (window.IndexLy.ui && window.IndexLy.ui.React))))) ||
              null;
  var uiKit = (typeof IndexLy !== "undefined" && (IndexLy.ui && IndexLy.ui.components ? IndexLy.ui.components : IndexLy.ui)) ||
              (typeof window !== "undefined" && window.IndexLy && window.IndexLy.ui && (window.IndexLy.ui.components || window.IndexLy.ui)) ||
              null;
  var mount = (typeof IndexLy !== "undefined" && IndexLy.ui && IndexLy.ui.mount) ||
              (typeof window !== "undefined" && window.IndexLy && window.IndexLy.ui && window.IndexLy.ui.mount) ||
              null;
  var unmount = (typeof IndexLy !== "undefined" && IndexLy.ui && IndexLy.ui.unmount) ||
                (typeof window !== "undefined" && window.IndexLy && window.IndexLy.ui && window.IndexLy.ui.unmount) ||
                null;

  function resolveHostUi(ctx) {
    if (ctx && ctx.ui) {
      if (!uiKit) uiKit = ctx.ui.components || ctx.ui;
      if (!mount) mount = ctx.ui.mount;
      if (!unmount) unmount = ctx.ui.unmount;
      if (!React) React = ctx.ui.React;
    }
    if (!React && typeof window !== "undefined" && window.React) {
      React = window.React;
    }
    if (!React && typeof IndexLy !== "undefined" && IndexLy.React) {
      React = IndexLy.React;
    }
    if (!uiKit && typeof IndexLy !== "undefined" && IndexLy.ui) {
      uiKit = IndexLy.ui.components || IndexLy.ui;
      if (!mount) mount = IndexLy.ui.mount;
      if (!unmount) unmount = IndexLy.ui.unmount;
    }
    try {
      if ((!React || !uiKit) && typeof require === "function") {
        var ix = require("indexly");
        if (ix) {
          if (!React) React = ix.React;
          if (!uiKit) uiKit = ix.ui || ix.components;
          if (!mount) mount = ix.mount;
          if (!unmount) unmount = ix.unmount;
        }
      }
    } catch (e) {}
  }
  resolveHostUi(null);

  // Índice en memoria de la vault para deduplicar rápido por gdbId / nombre / enlace.
  var vaultIndex = { byGdb: {}, byName: {}, byLink: {} };

  var GDB_BASE = "https://app.lizardbyte.dev/GameDB/";
  var AM_CONCURRENCY = 16;
  var PICK_RENDER_LIMIT = 150;

  var STATUSES = [
    { id: "backlog", label: "Backlog", color: "var(--color-text-secondary, #94a3b8)" },
    { id: "playing", label: "Jugando", color: "var(--color-primary, #0ea5e9)" },
    { id: "done", label: "Terminado", color: "var(--color-success, #22c55e)" },
    { id: "dropped", label: "Abandonado", color: "var(--color-danger, #f87171)" },
  ];

  var state = {
    view: "library",      // library | search | detail | picker | settings | amatch
    gameId: null,
    libQuery: "",
    statusFilter: "all",
    sortBy: "recent",
    onlyWithSources: false,
    searchQuery: "",
    searchSeq: 0,
    pickIndexId: null,
    pickQuery: "",
    pickLimit: PICK_RENDER_LIMIT,
    picks: {},            // key -> source (selección temporal del picker)
    pickLoading: {},
    pickErrors: {},
    am: null,             // estado del auto-match en curso
  };

  // ---------- utilidades ----------

  // Iconos de línea (estilo lucide, como el resto de IndexLy) en lugar de emojis.
  var ICON_PATHS = {
    "✓": '<path d="M20 6 9 17l-5-5"/>',
    "🔗": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "🎮": '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
    "⚙": '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    "⚡": '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    "＋": '<path d="M5 12h14"/><path d="M12 5v14"/>',
    "★": '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    "⬇": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    "🔎": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "←": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    "↻": '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    "⧉": '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    "✕": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "⇄": '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  };

  function svgIcon(glyph, size) {
    var p = ICON_PATHS[glyph];
    if (!p) return "";
    var s = size || 13;
    var fill = glyph === "★" ? "currentColor" : "none";
    return '<svg class="gv-ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' + fill +
      '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }

  // Si el texto empieza por un glifo conocido, lo sustituye por su icono SVG.
  function setLabel(node, text) {
    var str = String(text);
    var glyph = Object.keys(ICON_PATHS).find(function (g) { return str.indexOf(g) === 0; });
    if (!glyph) { node.textContent = str; return node; }
    var rest = str.slice(glyph.length).trim();
    node.innerHTML = svgIcon(glyph) + (rest ? "<span>" + esc(rest) + "</span>" : "");
    if (!rest && !node.getAttribute("aria-label")) node.setAttribute("aria-label", glyph);
    return node;
  }

  // Variante para componentes React: devuelve icono + texto como nodos.
  function rLabel(text) {
    var str = String(text);
    var glyph = Object.keys(ICON_PATHS).find(function (g) { return str.indexOf(g) === 0; });
    if (!glyph || !React) return str;
    var rest = str.slice(glyph.length).trim();
    return React.createElement(
      "span",
      { className: "gv-rlabel" },
      React.createElement("span", { className: "gv-ico-wrap", "aria-hidden": "true", dangerouslySetInnerHTML: { __html: svgIcon(glyph) } }),
      rest || null
    );
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) setLabel(e, text);
    return e;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hueFor(s) {
    var h = 0;
    var str = String(s || "x");
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  function gradientFor(name) {
    var h = hueFor(name);
    return "linear-gradient(120deg, hsl(" + h + " 60% 30%) 0%, hsl(" + ((h + 45) % 360) + " 65% 20%) 100%)";
  }

  // Placeholder sobrio: mismo hash de tono por juego pero apagado.
  function phBackground(name) {
    var h = hueFor(name);
    var h2 = (h + 32) % 360;
    return "radial-gradient(120% 90% at 50% 0%, hsl(" + h + " 26% 21%) 0%, hsl(" + h2 + " 30% 12%) 55%, #0b101c 100%)";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    return m[3] + "/" + m[2] + "/" + m[1].slice(2);
  }

  function fmtNum(n) {
    try { return Number(n || 0).toLocaleString("es-ES"); } catch (e) { return String(n || 0); }
  }

  function normStr(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function statusOf(id) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].id === id) return STATUSES[i];
    return STATUSES[0];
  }

  function toast(msg, type, ms) {
    if (api && typeof api.showToast === "function") api.showToast(msg, type || "success", ms);
    else console.log("[GameVault]", msg);
  }

  // Fuerza al host a re-renderizar slots y a re-emitir items:hydrate, para que los
  // badges "✓ en vault" aparezcan en cuanto se guarda un juego.
  function refreshHost() {
    if (api && typeof api.refreshApp === "function") {
      try { api.refreshApp(); } catch (err) { /* host antiguo */ }
    }
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    if (api && typeof api.copyToClipboard === "function") return Promise.resolve(api.copyToClipboard(text));
    if (navigator.clipboard) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }

  function openExternal(url) {
    if (!url) return;
    if (api && typeof api.openLink === "function") { api.openLink(url); return; }
    window.open(url, "_blank", "noopener");
  }

  // ---------- vault ----------

  function rebuildVaultIndex() {
    vaultIndex = { byGdb: {}, byName: {}, byLink: {} };
    (gamesCache || []).forEach(function (g) {
      if (g.gdbId != null) vaultIndex.byGdb[String(g.gdbId)] = g;
      var nk = normStr(g.name);
      if (nk) vaultIndex.byName[nk] = g;
      (g.sources || []).forEach(function (s) {
        if (s && s.itemLink) vaultIndex.byLink[s.itemLink] = g;
      });
    });
  }

  function ensureGames(cb) {
    if (gamesCache) { cb(); return; }
    api.storage.get("gv_games").then(function (g) {
      gamesCache = Array.isArray(g) ? g : [];
      rebuildVaultIndex();
      cb();
    }).catch(function () { gamesCache = []; rebuildVaultIndex(); cb(); });
  }

  function saveGames() {
    rebuildVaultIndex();
    return api.storage.set("gv_games", gamesCache || []);
  }

  function findGame(id) {
    return (gamesCache || []).find(function (g) { return g.id === id; }) || null;
  }

  function currentGame() { return state.gameId ? findGame(state.gameId) : null; }

  function rerender() { if (pageRoot) renderPage(pageRoot); }

  function mergeSource(game, src) {
    if (!game || !src) return false;
    game.sources = game.sources || [];
    var dup = game.sources.some(function (s) {
      if (src.itemLink && s.itemLink) return s.itemLink === src.itemLink;
      return s.indexId === src.indexId && s.itemTitle === src.itemTitle;
    });
    if (dup) return false;
    game.sources.push(src);
    if (src.itemLink) vaultIndex.byLink[src.itemLink] = game;
    return true;
  }

  function makeRecord(partial) {
    var rec = {
      id: partial.id || ("m" + Date.now() + Math.random().toString(36).slice(2, 6)),
      name: String(partial.name || "Sin título").slice(0, 120),
      imageUrl: partial.imageUrl || "",
      coverUrl: partial.coverUrl || "",
      rating: partial.rating != null ? partial.rating : null,
      metacritic: partial.metacritic != null ? partial.metacritic : null,
      released: partial.released || "",
      genres: Array.isArray(partial.genres) ? partial.genres.slice(0, 8) : [],
      platforms: Array.isArray(partial.platforms) ? partial.platforms.slice(0, 12) : [],
      developer: partial.developer || "",
      pegi: partial.pegi || null,
      website: partial.website || "",
      description: partial.description || "",
      screenshots: Array.isArray(partial.screenshots) ? partial.screenshots.slice(0, 6) : [],
      gdbId: partial.gdbId != null ? String(partial.gdbId) : null,
      gdbUrl: partial.gdbUrl || "",
      status: STATUSES.some(function (s) { return s.id === partial.status; }) ? partial.status : "backlog",
      addedAt: partial.addedAt || Date.now(),
      sources: Array.isArray(partial.sources) ? partial.sources.filter(function (s) { return s && typeof s === "object"; }) : [],
    };
    (gamesCache || (gamesCache = [])).push(rec);
    if (rec.gdbId != null) vaultIndex.byGdb[String(rec.gdbId)] = rec;
    vaultIndex.byName[normStr(rec.name)] = rec;
    (rec.sources || []).forEach(function (s) { if (s.itemLink) vaultIndex.byLink[s.itemLink] = rec; });
    return rec;
  }

  // ---------- capa de datos compatible web / escritorio ----------
  // La web expone ix.games[]; el escritorio expone ix.getItems() (async) y ix.count.
  // Esta capa unifica ambos mundos y cachea por fuente.

  var sourceCache = {};   // id -> { items: null|[], promise: null|Promise, error: null|string }
  var dataGeneration = 0;

  function invalidateSourceCache() {
    sourceCache = {};
    dataGeneration++;
  }

  function getSources() {
    try {
      var list = api && typeof api.getIndexes === "function" ? api.getIndexes() : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn("[GameVault] getIndexes falló:", err);
      return [];
    }
  }

  function sourceCount(ix) {
    if (!ix) return 0;
    if (Array.isArray(ix.games)) return ix.games.length;
    var c = sourceCache[ix.id];
    if (c && c.items) return c.items.length;
    if (typeof ix.count === "number" && ix.count >= 0) return ix.count;
    return 0;
  }

  function firstString(obj, keys) {
    if (!obj || typeof obj !== "object") return "";
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  }

  function normalizeSourceItem(raw, ix) {
    if (raw == null) return null;
    if (typeof raw === "string") raw = { title: raw };
    if (typeof raw !== "object") return null;
    var title = firstString(raw, ["title", "name", "nombre", "titulo", "label", "headline"]);
    if (!title) return null;
    var link = firstString(raw, ["link", "url", "enlace", "magnet", "uri", "href", "downloadUrl", "download_url"]);
    var subtitle = firstString(raw, ["subtitle", "subtitulo", "size", "tamano", "file_size", "fileSize", "filesize"]);
    return {
      title: title.slice(0, 300),
      link: link,
      subtitle: subtitle,
      sourceId: ix ? ix.id : "",
      sourceName: (ix && ix.name) || "",
    };
  }

  // Cascada de obtención de items: getItems() del índice → api.getItemsBySource →
  // api.sources.getItems. Las dos últimas devuelven [] al fallar, así que solo se
  // usan como respaldo cuando la anterior devuelve vacío o lanza.
  function fetchRawItems(ix) {
    if (Array.isArray(ix.games)) return Promise.resolve(ix.games);
    var attempts = [];
    if (typeof ix.getItems === "function") attempts.push(function () { return ix.getItems(); });
    if (api && typeof api.getItemsBySource === "function") attempts.push(function () { return api.getItemsBySource(ix.id); });
    if (api && api.sources && typeof api.sources.getItems === "function") attempts.push(function () { return api.sources.getItems(ix.id); });
    if (!attempts.length) return Promise.resolve([]);

    function attempt(i) {
      if (i >= attempts.length) return Promise.resolve([]);
      return Promise.resolve().then(attempts[i]).then(function (list) {
        if (Array.isArray(list) && list.length) return list;
        if (i + 1 < attempts.length) return attempt(i + 1);
        return Array.isArray(list) ? list : [];
      }, function () {
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  function loadSourceItems(ix) {
    if (!ix) return Promise.resolve([]);
    var cached = sourceCache[ix.id];
    if (cached && cached.items) return Promise.resolve(cached.items);
    if (cached && cached.promise) return cached.promise;

    var entry = sourceCache[ix.id] || (sourceCache[ix.id] = { items: null, promise: null, error: null });
    var gen = dataGeneration;
    entry.promise = fetchRawItems(ix).then(function (raw) {
      if (gen !== dataGeneration) return [];
      var list = [];
      var seen = {};
      (Array.isArray(raw) ? raw : []).forEach(function (r) {
        var it = normalizeSourceItem(r, ix);
        if (!it) return;
        var key = (it.link || ("t:" + normStr(it.title))).toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        list.push(it);
      });
      entry.items = list;
      entry.promise = null;
      entry.error = null;
      return list;
    }, function (err) {
      entry.promise = null;
      entry.error = (err && err.message) || "No se pudo leer la fuente";
      return [];
    });
    return entry.promise;
  }

  // ---------- GameDB (datos IGDB vía LizardByte) — sin configuración ----------

  function gdbJson(path) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(GDB_BASE + path, { signal: ctrl.signal })
      .then(function (res) {
        clearTimeout(timer);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("GameDB respondió " + res.status);
        return res.json();
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  // Imágenes IGDB: la ficha trae t_thumb; pedimos tamaños mayores reescribiendo el prefijo.
  function igdbImg(url, size) {
    if (!url) return "";
    var u = String(url);
    if (u.indexOf("//") === 0) u = "https:" + u;
    return u.replace("/t_thumb/", "/t_" + (size || "thumb") + "/");
  }

  var gdbBucketCache = {};       // key -> Promise<{id:{name}}>
  var gdbPlatformsPromise = null;
  var gdbGameCache = {};         // id -> Promise<ficha>

  function gdbBucket(key) {
    if (!gdbBucketCache[key]) {
      gdbBucketCache[key] = gdbJson("buckets/" + encodeURIComponent(key) + ".json").then(function (j) {
        return j || {};
      }, function (err) {
        // No cachear fallos de red: permiten reintentar más tarde.
        delete gdbBucketCache[key];
        throw err;
      });
    }
    return gdbBucketCache[key];
  }

  function gdbPlatforms() {
    if (!gdbPlatformsPromise) {
      gdbPlatformsPromise = gdbJson("platforms/all.json").then(function (j) {
        var map = {};
        Object.keys(j || {}).forEach(function (id) { map[id] = (j[id] && j[id].name) || id; });
        return map;
      }, function (err) {
        gdbPlatformsPromise = null;
        throw err;
      });
    }
    return gdbPlatformsPromise;
  }

  function gdbGame(id) {
    var key = String(id);
    if (!gdbGameCache[key]) {
      gdbGameCache[key] = gdbJson("games/" + encodeURIComponent(key) + ".json").then(function (j) {
        if (!j) delete gdbGameCache[key];
        return j;
      }, function (err) {
        delete gdbGameCache[key];
        throw err;
      });
    }
    return gdbGameCache[key];
  }

  var ARTICLES = ["the ", "a ", "an ", "el ", "la ", "los ", "las ", "un ", "una ", "le ", "les ", "der ", "die ", "das ", "il ", "lo "];

  function stripArticle(s) {
    var n = normStr(s).replace(/\s+/g, " ").trim();
    for (var i = 0; i < ARTICLES.length; i++) {
      if (n.indexOf(ARTICLES[i]) === 0) return n.slice(ARTICLES[i].length);
    }
    return n;
  }

  function normalizeQuery(q) {
    return normStr(q).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  var GDB_ALIASES = {
    zelda: ["le", "th", "ze"],
    mario: ["su", "ma"],
    gta: ["gr", "gt"],
    witcher: ["th", "wi"],
    skyrim: ["th", "el", "sk"],
    pokemon: ["po"],
    pokémon: ["po"],
    elden: ["el"],
    souls: ["da", "de"],
    fifa: ["fi", "ea"],
    cod: ["ca", "co"],
    duty: ["ca", "du"],
    assassin: ["as"],
    cyberpunk: ["cy"],
    fantasy: ["fi", "fa"],
    resident: ["re", "bi"],
    silent: ["si"],
    monster: ["mo"],
    hunter: ["mo", "hu"],
    hollow: ["ho"],
    knight: ["ho", "kn"],
    sonic: ["so"],
    halo: ["ha"],
    doom: ["do"],
    fallout: ["fa"],
    forza: ["fo"],
    diablo: ["di"],
  };

  function primaryBucketKeys(nq) {
    var keys = [];
    function add(s) {
      var compact = String(s || "").replace(/[^a-z0-9]/g, "");
      if (!compact) return;
      var k = compact.length >= 2 ? compact.slice(0, 2) : compact.slice(0, 1);
      if (keys.indexOf(k) < 0) keys.push(k);
    }
    add(nq);
    add(stripArticle(nq));

    // Palabras individuales significativas (ej: "Zelda", "Mario", "Duty")
    var words = nq.split(" ").filter(function (w) { return w.length >= 2; });
    words.forEach(function (w) {
      add(w);
      if (GDB_ALIASES[w]) {
        GDB_ALIASES[w].forEach(function (ak) {
          if (keys.indexOf(ak) < 0) keys.push(ak);
        });
      }
    });

    return keys;
  }

  function fallbackBucketKeys(nq) {
    var keys = [];
    [nq, stripArticle(nq)].forEach(function (s) {
      var compact = String(s || "").replace(/[^a-z0-9]/g, "");
      if (compact) {
        var k = compact.slice(0, 1);
        if (keys.indexOf(k) < 0) keys.push(k);
      }
    });
    return keys;
  }

  function mergeBuckets(keys) {
    return Promise.all(keys.map(function (k) {
      return gdbBucket(k).catch(function () { return {}; });
    })).then(function (buckets) {
      var pool = {};
      buckets.forEach(function (b) {
        if (!b) return;
        Object.keys(b).forEach(function (id) { if (!pool[id]) pool[id] = b[id]; });
      });
      return pool;
    });
  }

  function rankPool(pool, nq) {
    var alt = stripArticle(nq);
    var words = nq.split(" ").filter(Boolean);
    var altWords = alt.split(" ").filter(Boolean);
    var out = [];

    function score(query, qwords, nn) {
      if (!query) return 9;
      if (nn === query) return 0;
      if (nn.indexOf(query) === 0) return 1;
      if (nn.indexOf(query) >= 0) return 2;
      if (qwords.length > 1 && qwords.every(function (w) { return nn.indexOf(w) >= 0; })) return 3;
      if (qwords.length > 0 && qwords.some(function (w) { return w.length >= 3 && nn.indexOf(w) >= 0; })) return 4;
      return 9;
    }

    Object.keys(pool).forEach(function (id) {
      var name = (pool[id] && pool[id].name) || "";
      if (!name) return;
      var nn = normStr(name);
      var rank = Math.min(score(nq, words, nn), score(alt, altWords, nn));
      if (rank >= 9) return;
      out.push({ id: id, name: name, rank: rank, norm: nn });
    });

    out.sort(function (a, b) {
      return a.rank - b.rank ||
        a.norm.length - b.norm.length ||
        a.name.localeCompare(b.name);
    });
    return out;
  }

  // Búsqueda en dos pasadas: buckets de 2 letras (con y sin artículo inicial) y,
  // si no hay nada, buckets de 1 letra. Los buckets fallidos no se cachean.
  function gdbSearch(q, limit) {
    var nq = normalizeQuery(q);
    if (!nq) return Promise.resolve([]);
    var max = limit || 25;
    var primary = primaryBucketKeys(nq);
    return mergeBuckets(primary).then(function (pool) {
      var res = rankPool(pool, nq);
      if (res.length) return res.slice(0, max);
      var fallback = fallbackBucketKeys(nq).filter(function (k) { return primary.indexOf(k) < 0; });
      if (!fallback.length) return [];
      return mergeBuckets(fallback).then(function (pool2) {
        return rankPool(pool2, nq).slice(0, max);
      });
    }).then(function (list) {
      return list.map(function (r) { return { id: r.id, name: r.name, rank: r.rank }; });
    });
  }

  // Mapa ficha GameDB → registro de vault.
  function mapGameDB(j) {
    if (!j) return null;
    var minDate = null;
    (Array.isArray(j.release_dates) ? j.release_dates : []).forEach(function (rd) {
      if (rd && rd.date && (minDate === null || rd.date < minDate)) minDate = rd.date;
    });
    var released = minDate ? new Date(minDate * 1000).toISOString().slice(0, 10) : "";
    var developer = "";
    (Array.isArray(j.involved_companies) ? j.involved_companies : []).some(function (c) {
      if (c && c.developer && c.company && c.company.name) { developer = c.company.name; return true; }
      return false;
    });
    var pegi = null;
    (Array.isArray(j.age_ratings) ? j.age_ratings : []).forEach(function (ar) {
      if (ar && ar.organization && /pegi/i.test(ar.organization.name || "") && ar.rating_category) {
        pegi = String(ar.rating_category.rating || "");
      }
    });
    var cover = j.cover && j.cover.url ? igdbImg(j.cover.url, "cover_big") : "";
    var banner = "";
    if (Array.isArray(j.artworks) && j.artworks[0] && j.artworks[0].url) banner = igdbImg(j.artworks[0].url, "720p");
    else if (Array.isArray(j.screenshots) && j.screenshots[0] && j.screenshots[0].url) banner = igdbImg(j.screenshots[0].url, "720p");
    else if (cover) banner = cover;
    return {
      gdbId: j.id != null ? String(j.id) : null,
      gdbUrl: j.url || (j.slug ? "https://www.igdb.com/games/" + j.slug : ""),
      name: String(j.name || "Sin título").slice(0, 120),
      imageUrl: banner,
      coverUrl: cover,
      rating: typeof j.rating === "number" ? Math.round((j.rating / 20) * 10) / 10 : null,
      metacritic: typeof j.aggregated_rating === "number" ? Math.round(j.aggregated_rating) : null,
      released: released,
      genres: (Array.isArray(j.genres) ? j.genres : []).map(function (g) { return g && g.name; }).filter(Boolean).slice(0, 5),
      platforms: (Array.isArray(j.platforms) ? j.platforms : []).map(String).slice(0, 8), // IDs → resolver al pintar
      developer: developer,
      pegi: pegi,
      website: "",
      description: String(j.summary || j.storyline || "").slice(0, 4000),
      screenshots: (Array.isArray(j.screenshots) ? j.screenshots : []).slice(0, 4).map(function (s) {
        return s && s.url ? igdbImg(s.url, "screenshot_med") : null;
      }).filter(Boolean),
    };
  }

  function mergeMappedInto(game, mapped, overwrite) {
    if (!game || !mapped) return;
    if (mapped.gdbId) game.gdbId = mapped.gdbId;
    if (mapped.gdbUrl) game.gdbUrl = mapped.gdbUrl;
    if (mapped.imageUrl) game.imageUrl = mapped.imageUrl;
    if (mapped.coverUrl) game.coverUrl = mapped.coverUrl;
    if (mapped.rating != null) game.rating = mapped.rating;
    if (mapped.metacritic != null) game.metacritic = mapped.metacritic;
    if (mapped.released) game.released = mapped.released;
    if (mapped.genres && mapped.genres.length) game.genres = mapped.genres;
    if (mapped.platforms && mapped.platforms.length) game.platforms = mapped.platforms;
    if (mapped.developer) game.developer = mapped.developer;
    if (mapped.pegi) game.pegi = mapped.pegi;
    if (mapped.description && (overwrite || !game.description)) game.description = mapped.description;
    if (mapped.screenshots && mapped.screenshots.length) game.screenshots = mapped.screenshots;
    if (mapped.website) game.website = mapped.website;
    if (game.gdbId != null) vaultIndex.byGdb[String(game.gdbId)] = game;
  }

  function addGdbGameMapped(mapped, extraSources) {
    if (!mapped) return null;
    if (mapped.gdbId != null && vaultIndex.byGdb[String(mapped.gdbId)]) return vaultIndex.byGdb[String(mapped.gdbId)];
    var rec = makeRecord({
      name: mapped.name,
      imageUrl: mapped.imageUrl,
      coverUrl: mapped.coverUrl,
      rating: mapped.rating,
      metacritic: mapped.metacritic,
      released: mapped.released,
      genres: mapped.genres,
      platforms: mapped.platforms,
      developer: mapped.developer,
      pegi: mapped.pegi,
      website: mapped.website,
      description: mapped.description,
      screenshots: mapped.screenshots,
      gdbId: mapped.gdbId,
      gdbUrl: mapped.gdbUrl,
      sources: (extraSources || []).slice(),
    });
    return rec;
  }

  // ---------- añadir desde los resultados de IndexLy ----------

  function findVaultForItem(name, link) {
    if (link && vaultIndex.byLink[link]) return vaultIndex.byLink[link];
    var nk = normStr(name);
    if (nk && vaultIndex.byName[nk]) return vaultIndex.byName[nk];
    return null;
  }

  function sourceForItem(game) {
    var name = String(game && (game.source_name || game.source) || "").trim();
    var idx = getSources().find(function (i) { return i.name === name; });
    return {
      indexId: idx ? idx.id : null,
      sourceName: name || (idx ? idx.name : ""),
      itemTitle: String(game.title || "").slice(0, 300),
      itemLink: game.link || "",
    };
  }

  function quickAdd(game) {
    ensureGames(function () { quickAddNow(game); });
  }

  function quickAddNow(game) {
    var name = String(game && game.title || "").trim();
    if (!name) return;
    var src = sourceForItem(game);
    var existing = findVaultForItem(name, src.itemLink);

    if (existing) {
      if (src.itemLink && mergeSource(existing, src)) {
        saveGames();
        refreshHost();
        toast("Fuente añadida a «" + existing.name + "»", "success");
      } else {
        toast("Ya está en tu vault: " + existing.name, "warning");
      }
      if (state.view === "library") rerender();
      return;
    }

    var rec = makeRecord({
      name: name.slice(0, 120),
      sources: src.itemLink ? [src] : [],
    });
    saveGames();
    refreshHost();
    toast("«" + rec.name + "» añadido a GameVault", "success");
    if (state.view === "library") rerender();

    // Enriquecimiento en segundo plano: carátula y ficha completa.
    gdbSearch(name, 5).then(function (hits) {
      if (!hits.length) return null;
      return gdbGame(hits[0].id);
    }).then(function (j) {
      if (!j) return;
      var cur = findGame(rec.id);
      if (!cur) return;
      mergeMappedInto(cur, mapGameDB(j), false);
      saveGames();
      if (state.view === "detail" && state.gameId === cur.id) rerender();
    }).catch(function () { /* sin red: queda como añadido manual */ });
  }

  // ---------- añadido manual ----------

  function addManualGame(name, imageUrl, description, year) {
    var rec = makeRecord({
      name: String(name).slice(0, 120),
      imageUrl: String(imageUrl || "").trim(),
      coverUrl: String(imageUrl || "").trim(),
      released: /^\d{4}$/.test(String(year || "")) ? String(year) + "-01-01" : "",
      description: String(description || "").trim().slice(0, 4000),
    });
    saveGames();
    toast("«" + rec.name + "» añadido a la vault", "success");
    if (state.view === "library") rerender();
    return rec;
  }

  function openManualAdd() {
    api.modal({
      title: "Añadir juego a mano",
      html: function (body) {
        body.innerHTML =
          '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<label class="ix-field gv-field"><span class="ix-field__label">Título <span class="ix-field__required">*</span></span><input id="gv-m-name" class="ix-input gv-input box" style="width:100%" placeholder="Ej: Hollow Knight" maxlength="120" /></label>' +
          '<label class="ix-field gv-field"><span class="ix-field__label">Año (opcional)</span><input id="gv-m-year" class="ix-input gv-input box" style="width:100%" placeholder="2017" maxlength="4" inputmode="numeric" /></label>' +
          '<label class="ix-field gv-field"><span class="ix-field__label">URL de imagen (opcional)</span><input id="gv-m-img" class="ix-input gv-input box" style="width:100%" placeholder="https://…/cover.jpg" /></label>' +
          '<label class="ix-field gv-field"><span class="ix-field__label">Descripción (opcional)</span><textarea id="gv-m-desc" class="ix-input ix-textarea gv-input box" style="width:100%;resize:vertical;min-height:80px" placeholder="Notas, género, por qué lo quieres…"></textarea></label>' +
          "</div>";
      },
      actions: [
        { label: "Cancelar" },
        {
          label: "Añadir", primary: true, onClick: function (bodyEl) {
            var nameEl = bodyEl.querySelector("#gv-m-name");
            var yearEl = bodyEl.querySelector("#gv-m-year");
            var imgEl = bodyEl.querySelector("#gv-m-img");
            var descEl = bodyEl.querySelector("#gv-m-desc");
            var name = nameEl ? nameEl.value.trim() : "";
            if (!name) { toast("El título es obligatorio", "warning"); return false; }
            addManualGame(name, imgEl ? imgEl.value.trim() : "", descEl ? descEl.value : "", yearEl ? yearEl.value.trim() : "");
          }
        },
      ],
    });
  }

  // ---------- estilos ----------

  function ensureStyles() {
    if (document.getElementById("gv-styles")) return;
    var s = document.createElement("style");
    s.id = "gv-styles";
    s.textContent = [
      ".gv-badge-vault{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;font-family:var(--font-mono,ui-monospace,monospace);color:var(--color-success,#4ade80);background:rgba(34,197,94,0.10);border:1px solid rgba(34,197,94,0.25);border-radius:var(--radius-full,9999px);padding:2px 8px;margin-top:6px;width:max-content;line-height:1.4}",
      ".gv-page{display:flex;flex-direction:column;gap:16px;color:var(--color-text-secondary,#94a3b8);min-width:0;animation:gvFadeUp .25s ease both}",
      ".gv-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}",
      ".gv-title-wrap{display:flex;align-items:center;gap:12px;min-width:0}",
      ".gv-logo{width:40px;height:40px;border-radius:var(--radius-lg,12px);display:grid;place-items:center;font-size:20px;flex-shrink:0;background:linear-gradient(135deg,rgba(14,165,233,0.22),rgba(14,165,233,0.04));border:1px solid var(--color-primary-border,rgba(14,165,233,0.3));box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 4px 16px rgba(0,0,0,0.25)}",
      ".gv-title-txt{display:flex;flex-direction:column;gap:2px;min-width:0}",
      ".gv-title-txt h4{margin:0;font-size:var(--text-lg,17px);font-weight:var(--weight-bold,700);color:var(--color-text,#f1f5f9);letter-spacing:var(--tracking-tight,-0.015em);line-height:1.2}",
      ".gv-title-txt small{font-size:11.5px;color:var(--color-text-tertiary,#64748b)}",
      ".gv-spacer{flex:1}",
      ".gv-search-wrap{position:relative;display:flex;align-items:center;min-width:0;margin-top:0 !important}",
      ".gv-search-wrap .ix-search__icon{position:absolute;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;pointer-events:none;color:var(--color-text-tertiary,#64748b);z-index:1}",
      ".gv-search-wrap .ix-search__clear{position:absolute;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;z-index:2}",
      ".gv-btn{background:transparent;border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-full,9999px);color:var(--color-text-secondary,#94a3b8);padding:0 14px;height:var(--ix-control-h-sm,30px);font-size:var(--text-xs,11.5px);font-weight:var(--weight-medium,500);cursor:pointer;transition:all 0.15s cubic-bezier(0.2,0.8,0.2,1);white-space:nowrap;font-family:inherit;line-height:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;user-select:none}",
      ".gv-btn:hover:not(:disabled){background:var(--color-surface-hover,rgba(255,255,255,0.05));color:var(--color-text,#f1f5f9);border-color:var(--color-border-hover,#24344f)}",
      ".gv-btn:active:not(:disabled){transform:translateY(1px)}",
      ".gv-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--color-primary-ring,rgba(14,165,233,0.2))}",
      ".gv-btn:disabled{opacity:0.45;cursor:not-allowed;transform:none}",
      ".gv-btn-primary{background:var(--color-text,#f1f5f9);border-color:var(--color-text,#f1f5f9);color:var(--color-bg,#070a12);font-weight:var(--weight-semibold,600);box-shadow:0 2px 8px rgba(255,255,255,0.1)}",
      ".gv-btn-primary:hover:not(:disabled){background:var(--color-inverse-hover,#e2e8f0);border-color:var(--color-inverse-hover,#e2e8f0);color:var(--color-bg,#070a12)}",
      ".gv-btn-danger{background:rgba(239,68,68,0.1);border-color:rgba(248,113,113,0.28);color:var(--color-danger,#f87171)}",
      ".gv-btn-danger:hover:not(:disabled){background:rgba(239,68,68,0.18);border-color:rgba(248,113,113,0.45);color:var(--color-danger,#fca5a5)}",
      ".gv-chip{background:transparent;border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-full,9999px);color:var(--color-text-secondary,#94a3b8);padding:0 12px;height:28px;font-size:11px;font-weight:var(--weight-medium,500);cursor:pointer;transition:all 0.15s cubic-bezier(0.2,0.8,0.2,1);font-family:inherit;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;user-select:none}",
      ".gv-chip:hover:not(:disabled){color:var(--color-text,#f1f5f9);background:var(--color-surface-hover,rgba(255,255,255,0.04));border-color:var(--color-border-hover,#24344f)}",
      ".gv-chip:focus-visible{outline:none;box-shadow:0 0 0 3px var(--color-primary-ring,rgba(14,165,233,0.2))}",
      ".gv-chip.active{background:var(--color-primary-soft,rgba(14,165,233,0.12));border-color:var(--color-primary-border,rgba(14,165,233,0.4));color:var(--color-primary-text,#38bdf8);font-weight:var(--weight-semibold,600)}",
      ".gv-chip .gv-chip-n{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:var(--radius-full,9999px);background:rgba(127,127,127,0.16);font-family:var(--font-mono,ui-monospace,monospace);font-size:10px;font-weight:600}",
      ".gv-input{background:var(--color-bg,#070a12);border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-full,9999px);padding:0 14px;height:var(--ix-control-h-md,36px);color:var(--color-text,#f1f5f9);font-size:var(--text-base,13px);outline:none;min-width:0;font-family:inherit;transition:border-color .15s,box-shadow .15s,background .15s}",
      ".gv-input::placeholder{color:var(--color-text-tertiary,#64748b)}",
      ".gv-input:focus{border-color:var(--color-primary-border,rgba(14,165,233,0.5));background:var(--color-surface,#10151f);box-shadow:0 0 0 3px var(--color-primary-ring,rgba(14,165,233,0.15))}",
      ".gv-input.box{border-radius:var(--radius-md,8px)}",
      ".gv-select{appearance:none;background-color:var(--color-surface,#10151f);border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-full,9999px);color:var(--color-text-secondary,#94a3b8);font-size:11.5px;font-weight:500;height:var(--ix-control-h-md,36px);padding:0 32px 0 14px;cursor:pointer;font-family:inherit;max-width:100%;transition:border-color .15s}",
      ".gv-select:hover{border-color:var(--color-border-hover,#24344f)}",
      ".gv-select:focus{outline:none;border-color:var(--color-primary-border,rgba(14,165,233,0.5));box-shadow:0 0 0 3px var(--color-primary-ring,rgba(14,165,233,0.15))}",
      ".gv-toolbar{display:flex !important;flex-direction:row !important;align-items:center !important;gap:12px !important;flex-wrap:wrap !important;background:var(--color-surface,#10151f);border:1px solid var(--color-border,#1a2332);border-radius:var(--radius-xl,16px);padding:12px 16px;box-sizing:border-box !important;width:100% !important}",
      ".gv-am-toolbar{display:flex !important;flex-direction:row !important;align-items:center !important;gap:12px !important;flex-wrap:wrap !important;width:100% !important;box-sizing:border-box !important;padding:14px 18px !important}",
      ".gv-toolbar .gv-search-wrap{flex:1 1 200px;margin-top:0 !important}",
      ".gv-toolbar .gv-search-wrap .ix-search__input{height:var(--ix-control-h-md,36px);padding-left:36px;padding-right:32px;font-size:12.5px;border-radius:var(--radius-full,9999px)}",
      ".gv-toolbar .gv-search-wrap .ix-search__icon{left:12px}",
      ".gv-toolbar .gv-search-wrap .ix-search__clear{right:6px}",
      ".gv-search-section{display:flex;flex-direction:column;gap:12px;width:100%}",
      ".gv-search-box{display:flex;align-items:center;gap:10px;width:100%}",
      ".gv-search-input-wrap{flex:1;position:relative;display:flex;align-items:center;margin-top:0 !important}",
      ".gv-search-input-wrap .ix-search__input{height:46px;border-radius:var(--radius-xl,14px);padding-left:44px;padding-right:44px;background:var(--color-surface,#10151f);border:1px solid var(--color-border,#1a2332);font-size:13.5px;color:var(--color-text,#f1f5f9);width:100%;transition:border-color .15s,box-shadow .15s,background .15s}",
      ".gv-search-input-wrap .ix-search__input:focus{border-color:var(--color-primary-border,rgba(14,165,233,0.5));background:var(--color-surface-hover,#141b29);box-shadow:0 0 0 3px var(--color-primary-ring,rgba(14,165,233,0.15))}",
      ".gv-search-input-wrap .ix-search__icon{left:14px}",
      ".gv-search-input-wrap .ix-search__clear{right:10px}",
      ".gv-search-btn{height:46px;padding:0 24px;border-radius:var(--radius-xl,14px);font-size:13.5px;font-weight:600;flex-shrink:0}",
      ".gv-search-results{max-height:none;overflow:visible;margin-top:8px}",
      ".gv-res-card{display:flex !important;flex-direction:row !important;align-items:center !important;gap:16px !important;padding:12px 18px !important;min-height:86px !important;box-sizing:border-box !important;border-radius:var(--radius-xl,14px) !important;background:var(--color-surface,#10151f) !important;border:1px solid var(--color-border,#1a2332) !important;overflow:hidden !important;transition:border-color .15s,transform .15s,box-shadow .15s !important}",
      ".gv-res-card:hover{border-color:var(--color-primary-border,rgba(14,165,233,0.4)) !important;background:var(--color-surface-hover,#141b29) !important;transform:translateY(-1px) !important;box-shadow:0 8px 24px rgba(0,0,0,0.35) !important}",
      ".gv-suggestions-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".gv-suggestions-row .gv-chip{background:var(--color-surface,#10151f);border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-full,9999px);color:var(--color-text-secondary,#94a3b8);padding:0 12px;height:26px;font-size:11.5px;cursor:pointer;transition:all .15s}",
      ".gv-suggestions-row .gv-chip:hover{background:var(--color-surface-hover,rgba(255,255,255,0.06));color:var(--color-text,#f1f5f9);border-color:var(--color-border-hover,#24344f)}",
      ".gv-load-more-wrap{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:8px;padding:24px 0 16px}",
      ".gv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(188px,1fr));gap:16px;overflow:auto;padding:2px}",
      ".gv-card{position:relative;background:var(--color-surface,#10151f);border:1px solid var(--color-border,#1a2332);border-radius:var(--radius-xl,16px);overflow:hidden;cursor:pointer;display:flex;flex-direction:column;box-shadow:var(--shadow-card,0 4px 14px rgba(0,0,0,0.28));transition:transform .15s cubic-bezier(.2,.8,.2,1),border-color .15s,box-shadow .15s;content-visibility:auto;contain-intrinsic-size:0 320px;contain:layout paint;transform:translateZ(0);will-change:transform;min-width:0}",
      ".gv-card:hover{transform:translateY(-3px) translateZ(0);border-color:var(--color-primary-border,rgba(14,165,233,0.38));box-shadow:0 12px 28px rgba(0,0,0,0.4),0 0 0 1px var(--color-primary-soft,rgba(14,165,233,0.15))}",
      ".gv-card:focus-visible{outline:none;box-shadow:0 0 0 3px var(--color-primary-ring,rgba(14,165,233,0.25))}",
      ".gv-poster-wrap{position:relative;overflow:hidden;background:var(--color-bg,#070a12);aspect-ratio:3/4;flex-shrink:0}",
      ".gv-poster-wrap::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1px);background-size:14px 14px;mask-image:linear-gradient(180deg,black,transparent 80%);-webkit-mask-image:linear-gradient(180deg,black,transparent 80%);pointer-events:none;z-index:0}",
      ".gv-poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:0;opacity:0;transition:opacity .35s ease,transform .35s cubic-bezier(.2,.8,.2,1);transform:translateZ(0);will-change:transform}",
      ".gv-poster.is-loaded{opacity:1}",
      ".gv-card:hover .gv-poster.is-loaded,.gv-card:focus-visible .gv-poster.is-loaded{transform:scale(1.03) translateZ(0)}",
      ".gv-poster-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:0}",
      ".gv-poster-initial{display:grid;place-items:center;width:58px;height:58px;border-radius:var(--radius-lg,14px);font-size:24px;font-weight:700;color:#fff;background:rgba(20,27,41,0.85);border:1px solid rgba(255,255,255,0.2);text-shadow:0 2px 8px rgba(0,0,0,0.5);box-shadow:0 8px 20px rgba(0,0,0,0.35)}",
      ".gv-rating-pill{position:absolute;top:10px;right:10px;z-index:3;display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;font-family:var(--font-mono,ui-monospace,monospace);color:var(--color-warning,#fbbf24);background:rgba(10,15,26,0.88);border:1px solid rgba(251,191,36,0.32);padding:3px 8px;border-radius:var(--radius-full,9999px);box-shadow:0 4px 12px rgba(0,0,0,0.35)}",
      ".gv-card-action{position:absolute;top:10px;left:10px;z-index:3;width:30px;height:30px;display:grid;place-items:center;border-radius:var(--radius-full,9999px);border:1px solid rgba(255,255,255,0.18);background:rgba(10,15,26,0.88);color:var(--color-inverse-hover,#e2e8f0);font-size:13px;cursor:pointer;opacity:0;transform:translateY(-2px);transition:opacity .15s,transform .15s,background .15s;font-family:inherit;padding:0}",
      ".gv-card:hover .gv-card-action,.gv-card:focus-within .gv-card-action,.gv-card:focus-visible .gv-card-action{opacity:1;transform:none}",
      ".gv-card-action:hover{background:var(--color-primary,#0ea5e9);border-color:transparent;color:#fff}",
      ".gv-card-body{padding:12px 14px 10px;display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}",
      ".gv-card-name{font-size:13.5px;font-weight:600;color:var(--color-text,#f1f5f9);letter-spacing:-0.01em;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px}",
      ".gv-card-sub{font-size:11.5px;color:var(--color-text-secondary,#94a3b8);font-weight:500;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".gv-card-foot{display:flex;align-items:center;gap:8px;border-top:1px solid var(--color-border,#1a2332);padding:9px 14px 11px;margin-top:auto;background:rgba(0,0,0,0.12)}",
      ".gv-src-stat{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono,ui-monospace,monospace);font-size:10.5px;color:var(--color-text-tertiary,#64748b);white-space:nowrap}",
      ".gv-src-stat.has{color:var(--color-primary-text,#38bdf8)}",
      ".gv-status-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}",
      ".gv-status-lbl{margin-left:auto;font-size:10.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "@keyframes gvFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      "@keyframes gvShimmer{0%{background-position:-320px 0}100%{background-position:320px 0}}",
      ".gv-skel{height:56px;border-radius:var(--radius-md,10px);background:linear-gradient(90deg,var(--color-surface,#10151f) 0%,var(--color-surface-hover,#16202f) 50%,var(--color-surface,#10151f) 100%);background-size:320px 100%;animation:gvShimmer 1.2s linear infinite;border:1px solid var(--color-border,#1a2332)}",
      ".gv-detail{display:flex;flex-direction:column;gap:16px;animation:gvFadeUp .3s ease both}",
      ".gv-hero{position:relative;border-radius:var(--radius-xl,16px);overflow:hidden;border:1px solid var(--color-border,#1a2332);background:var(--color-bg,#070a12);min-height:270px;flex-shrink:0}",
      ".gv-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}",
      ".gv-hero-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}",
      ".gv-hero-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,10,18,0.1) 20%,rgba(7,10,18,0.6) 60%,var(--color-surface,#0d1320) 100%);pointer-events:none}",
      ".gv-hero-rating{position:absolute;top:14px;right:14px;z-index:2;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;font-family:var(--font-mono,ui-monospace,monospace);color:var(--color-warning,#fbbf24);background:rgba(7,10,18,0.75);border:1px solid rgba(251,191,36,0.35);padding:4px 10px;border-radius:var(--radius-full,9999px);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}",
      ".gv-hero-inner{position:absolute;left:0;right:0;bottom:0;z-index:1;display:flex;gap:20px;align-items:flex-end;padding:20px;min-width:0}",
      ".gv-hero-cover{width:148px;aspect-ratio:3/4;object-fit:cover;border-radius:var(--radius-lg,14px);border:1px solid rgba(255,255,255,0.16);box-shadow:0 16px 36px rgba(0,0,0,0.55);flex-shrink:0;background:var(--color-surface,#0d1528);display:block}",
      ".gv-hero-cover-ph{width:148px;aspect-ratio:3/4;border-radius:var(--radius-lg,14px);border:1px solid rgba(255,255,255,0.16);box-shadow:0 16px 36px rgba(0,0,0,0.55);flex-shrink:0;display:flex;align-items:center;justify-content:center}",
      ".gv-hero-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding-bottom:2px}",
      ".gv-title-xl{margin:0;font-size:24px;font-weight:800;letter-spacing:-0.02em;line-height:1.2;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,0.6)}",
      ".gv-hero-sub{font-size:13px;font-weight:500;color:var(--color-text-secondary,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".gv-stats{display:flex !important;flex-direction:row !important;align-items:center !important;justify-content:space-around !important;gap:16px !important;flex-wrap:wrap !important;background:var(--color-surface,#10151f);border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-xl,16px);padding:18px 24px !important}",
      ".gv-stat{display:flex !important;flex-direction:column !important;align-items:center !important;text-align:center !important;gap:4px !important;flex:1 1 80px !important;min-width:65px !important}",
      ".gv-stat-score{font-size:22px !important;font-weight:700 !important;letter-spacing:-0.01em !important;color:var(--color-text,#f1f5f9) !important;line-height:1.2 !important;font-family:var(--font-mono,ui-monospace,monospace) !important}",
      ".gv-stat-score.amber{color:var(--color-warning,#fbbf24) !important}",
      ".gv-stat-lbl{font-size:10px !important;font-weight:600 !important;text-transform:uppercase !important;letter-spacing:0.08em !important;color:var(--color-text-tertiary,#64748b) !important}",
      ".gv-desc-full{margin:0;font-size:13.5px;line-height:1.7;color:var(--color-text-secondary,#cbd5e1);white-space:pre-wrap}",
      ".gv-desc-clamp{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}",
      ".gv-desc-clamp.gv-fade{mask-image:linear-gradient(180deg,black 65%,transparent 100%);-webkit-mask-image:linear-gradient(180deg,black 65%,transparent 100%)}",
      ".gv-more{align-self:flex-start;background:transparent;border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-full,9999px);color:var(--color-text-secondary,#94a3b8);padding:5px 14px;font-size:11.5px;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit}",
      ".gv-more:hover{background:var(--color-surface-hover,rgba(255,255,255,0.05));color:var(--color-text,#f1f5f9);border-color:var(--color-border-hover,#24344f)}",
      ".gv-shots{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}",
      ".gv-section{display:flex;flex-direction:column;gap:14px;background:var(--color-surface,#10151f);border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-xl,16px);padding:16px 20px}",
      ".gv-section-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".gv-section-title h5{margin:0;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text,#f1f5f9)}",
      ".gv-src-row{display:flex !important;flex-direction:row !important;align-items:center !important;gap:12px !important;border:1px solid var(--color-border,#1e293b);background:var(--color-bg,#070a12);border-radius:var(--radius-lg,12px) !important;padding:12px 16px !important;transition:border-color .15s,background .15s;box-sizing:border-box !important;min-width:0 !important}",
      ".gv-src-row:hover{border-color:var(--color-border-hover,#24344f);background:var(--color-surface-hover,rgba(255,255,255,0.02))}",
      ".gv-src-info{flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;gap:2px !important}",
      ".gv-src-info strong{font-size:13px !important;color:var(--color-text,#f1f5f9) !important;font-weight:600 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important}",
      ".gv-src-info small{font-size:11.5px !important;color:var(--color-text-tertiary,#64748b) !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important}",
      ".gv-results{display:flex !important;flex-direction:column !important;gap:10px !important;overflow:auto !important;max-height:min(600px,68vh) !important;padding-right:4px !important;width:100% !important;box-sizing:border-box !important}",
      ".gv-res-row{display:flex !important;flex-direction:row !important;align-items:center !important;gap:14px !important;border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-xl,14px) !important;padding:12px 16px !important;background:var(--color-surface,#10151f);transition:border-color .15s,background .15s;min-width:0 !important;box-sizing:border-box !important}",
      ".gv-res-row:hover{border-color:var(--color-border-hover,#24344f) !important;background:var(--color-surface-hover,#16202f) !important}",
      ".gv-res-img{width:56px !important;height:76px !important;object-fit:cover !important;border-radius:8px !important;background:var(--color-bg,#070a12);flex-shrink:0 !important;display:block !important;box-shadow:0 4px 12px rgba(0,0,0,0.35)}",
      ".gv-res-info{flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;gap:3px !important}",
      ".gv-res-info strong{font-size:13.5px !important;color:var(--color-text,#f1f5f9) !important;font-weight:600 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important}",
      ".gv-res-info small{font-size:11.5px !important;color:var(--color-text-tertiary,#64748b) !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important}",
      ".gv-empty{margin:auto;text-align:center;color:var(--color-text-tertiary,#64748b);font-size:13px;line-height:1.6;padding:40px 20px;max-width:52ch}",
      ".gv-empty strong{display:block;color:var(--color-text,#f1f5f9);font-size:15px;margin-bottom:6px}",
      ".gv-field{display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--color-text-secondary,#94a3b8)}",
      ".gv-help{font-size:11.5px;color:var(--color-text-secondary,#94a3b8);line-height:1.65;background:var(--color-surface-raised,#141b29);border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-lg,12px);padding:12px 16px}",
      ".gv-help code{font-family:var(--font-mono,monospace);color:var(--color-primary-text,#38bdf8);font-size:10.5px}",
      ".gv-help a{color:var(--color-primary-text,#38bdf8);text-decoration:underline;text-underline-offset:2px}",
      ".gv-progress{height:6px;border-radius:var(--radius-full,9999px);background:rgba(255,255,255,0.08);overflow:hidden;flex:1;min-width:120px}",
      ".gv-progress > span{display:block;height:100%;border-radius:var(--radius-full,9999px);background:linear-gradient(90deg,var(--color-primary,#0ea5e9),#38bdf8);transition:width .25s ease}",
      ".gv-row{display:flex !important;flex-direction:row !important;gap:14px !important;align-items:center !important;border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-xl,14px) !important;padding:12px 16px !important;background:var(--color-surface,#10151f);min-width:0 !important;min-height:64px !important;box-sizing:border-box !important;transition:border-color .15s,background .15s;width:100% !important}",
      ".gv-row:hover{border-color:var(--color-border-hover,#24344f) !important;background:var(--color-surface-hover,#16202f) !important}",
      ".gv-row-thumb{width:48px !important;height:64px !important;border-radius:8px !important;overflow:hidden !important;flex-shrink:0 !important;background:var(--color-bg,#070a12);display:grid !important;place-items:center !important;font-size:16px !important;font-weight:700 !important;color:#fff !important;box-shadow:0 2px 8px rgba(0,0,0,0.3) !important}",
      ".gv-row-thumb img{width:100% !important;height:100% !important;object-fit:cover !important;display:block !important}",
      ".gv-row-main{flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;gap:3px !important}",
      ".gv-row-main strong{font-size:13.5px !important;color:var(--color-text,#f1f5f9) !important;font-weight:600 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important}",
      ".gv-row-sub{font-size:11.5px !important;color:var(--color-text-tertiary,#64748b) !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important}",
      ".gv-badge{font-size:10.5px;font-weight:600;padding:3px 9px;border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-full,9999px);color:var(--color-text-tertiary,#64748b);white-space:nowrap;flex-shrink:0}",
      ".gv-icon-btn{width:30px;height:30px;display:grid;place-items:center;border-radius:var(--radius-md,8px);border:1px solid var(--color-border,#1e293b);background:transparent;color:var(--color-text-secondary,#94a3b8);font-size:12px;cursor:pointer;flex-shrink:0;font-family:inherit;padding:0;transition:all .15s}",
      ".gv-icon-btn:hover:not(:disabled){background:var(--color-surface-hover,rgba(255,255,255,0.06));color:var(--color-text,#f1f5f9);border-color:var(--color-border-hover,#24344f)}",
      ".gv-icon-btn:disabled{opacity:.35;cursor:not-allowed}",
      ".gv-check{width:20px;height:20px;display:grid;place-items:center;border-radius:var(--radius-sm,6px);border:1px solid var(--color-border-hover,#24344f);background:transparent;color:#fff;font-size:12px;cursor:pointer;flex-shrink:0;font-family:inherit;padding:0;transition:all .15s}",
      ".gv-check.on{background:var(--color-primary,#0ea5e9);border-color:transparent}",
      ".gv-footbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;bottom:0;background:linear-gradient(180deg,rgba(7,10,18,0) 0%,var(--color-bg,#070a12) 36%);padding:14px 4px 4px;z-index:2}",
      ".gv-notice{font-size:12px;line-height:1.5;border-radius:var(--radius-md,10px);padding:10px 14px;border:1px solid var(--color-border,#1e293b);background:var(--color-surface,#10151f);color:var(--color-text-secondary,#94a3b8)}",
      ".gv-notice.ok{color:var(--color-success,#4ade80);border-color:rgba(34,197,94,0.28);background:rgba(34,197,94,0.08)}",
      ".gv-notice.err{color:var(--color-danger,#f87171);border-color:rgba(248,113,113,0.28);background:rgba(248,113,113,0.08)}",
      // — Alineado con el lenguaje visual de IndexLy —
      ".gv-ico{display:block;flex-shrink:0}",
      ".gv-rlabel{display:inline-flex;align-items:center;gap:6px}",
      ".gv-ico-wrap{display:inline-flex}",
      ".gv-btn .gv-ico,.gv-chip .gv-ico{opacity:.85}",
      ".gv-logo{width:36px;height:36px;border-radius:var(--radius-md,10px);background:var(--color-surface,#10151f);border:1px solid var(--color-border,#1a2332);color:var(--color-text-secondary,#a1a9b8);box-shadow:var(--shadow-inset-top,inset 0 1px 0 rgba(255,255,255,0.03))}",
      ".gv-logo .gv-ico{width:18px;height:18px}",
      ".gv-title-txt h4{font-size:var(--text-lg,16px);font-weight:var(--weight-semibold,600);letter-spacing:var(--tracking-tighter,-0.03em)}",
      ".gv-page .controls.filter-chips{justify-content:flex-start;gap:2px;padding:4px;margin-top:0;width:max-content;max-width:100%;overflow-x:auto;scrollbar-width:none}",
      ".gv-page .controls .gv-chip{border:none;background:transparent;color:var(--color-text-tertiary,#7c8595);height:30px;padding:0 13px}",
      ".gv-page .controls .gv-chip:hover:not(.active){color:var(--color-text-soft,#cbd5e1);background:rgba(255,255,255,0.04)}",
      ".gv-page .gv-chip.active,.gv-page .controls .gv-chip.active{background:var(--color-inverse,#fff);border-color:var(--color-inverse,#fff);color:var(--color-on-inverse,#0f172a);box-shadow:0 1px 6px rgba(0,0,0,0.15)}",
      ".gv-page .gv-chip.active .gv-chip-n{background:rgba(15,23,42,0.08)}",
      ".gv-toolbar,.gv-section,.gv-stats{box-shadow:var(--shadow-inset-top,inset 0 1px 0 rgba(255,255,255,0.03))}",
      ".gv-card{box-shadow:var(--shadow-inset-top,inset 0 1px 0 rgba(255,255,255,0.03))}",
      ".gv-card:hover{box-shadow:0 12px 32px rgba(0,0,0,0.3),0 0 0 1px var(--color-primary-border,rgba(14,165,233,0.22))}",
      ".gv-card-foot{background:transparent}",
      ".gv-card-action{background:color-mix(in srgb,var(--color-bg,#070a12) 80%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
      ".gv-card-action .gv-ico{width:14px;height:14px}",
      ".gv-rating-pill,.gv-hero-rating{background:color-mix(in srgb,var(--color-bg,#070a12) 80%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
      ".gv-rating-pill .gv-ico,.gv-hero-rating .gv-ico{width:11px;height:11px}",
      ".gv-title-xl{font-weight:var(--weight-bold,700);letter-spacing:var(--tracking-tighter,-0.03em)}",
      ".gv-poster-initial{border-radius:var(--radius-lg,12px)}",
      ".gv-btn:focus-visible,.gv-chip:focus-visible,.gv-card:focus-visible{outline:2px solid var(--color-primary,#0ea5e9);outline-offset:2px;box-shadow:none}",
      "@media (prefers-reduced-motion:reduce){.gv-card,.gv-poster,.gv-detail{transition:none;animation:none}.gv-skel{animation:none}}",
      "@media (max-width:640px){.gv-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}.gv-card-name{font-size:12.5px;min-height:34px}.gv-hero{min-height:200px}.gv-hero-inner{padding:14px;gap:12px}.gv-hero-cover,.gv-hero-cover-ph{width:104px}.gv-title-xl{font-size:18px}.gv-hero-sub{font-size:12px}.gv-shots img{height:92px}.gv-stats{gap:14px;padding:10px 14px}.gv-res-img{width:64px;height:40px}}",
    ].join("\n");
    document.head.appendChild(s);
  }

  // ---------- piezas de UI compartidas ----------

  function posterPh(game) {
    var ph = el("div", "gv-poster-ph");
    ph.style.background = phBackground(game.name);
    ph.appendChild(el("span", "gv-poster-initial", (game.name || "?").charAt(0).toUpperCase()));
    return ph;
  }

  function posterEl(game) {
    var url = game.coverUrl || game.imageUrl;
    if (url) {
      var img = document.createElement("img");
      img.className = "gv-poster";
      img.src = url;
      img.alt = game.name || "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("load", function () { img.classList.add("is-loaded"); });
      if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
      img.addEventListener("error", function () { img.replaceWith(posterPh(game)); });
      return img;
    }
    return posterPh(game);
  }

  function btnEl(label, cls, onClick, title) {
    var fullCls = "ix-btn ix-btn--sm gv-btn";
    if (cls) fullCls += " " + cls;
    if (cls && cls.indexOf("gv-btn-primary") >= 0 && fullCls.indexOf("ix-btn--primary") < 0) {
      fullCls += " ix-btn--primary";
    } else if (cls && cls.indexOf("gv-btn-danger") >= 0 && fullCls.indexOf("ix-btn--danger") < 0) {
      fullCls += " ix-btn--danger";
    } else if (fullCls.indexOf("ix-btn--primary") < 0 && fullCls.indexOf("ix-btn--danger") < 0) {
      fullCls += " ix-btn--secondary";
    }
    var b = el("button", fullCls, label);
    b.type = "button";
    if (title) b.title = title;
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function iconBtn(label, title, onClick) {
    var b = el("button", "ix-icon-btn ix-icon-btn--sm ix-icon-btn--secondary gv-icon-btn", label);
    b.type = "button";
    b.title = title || "";
    b.setAttribute("aria-label", title || label);
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function headerBar(page, opts) {
    opts = opts || {};
    var head = el("header", "gv-head");
    var wrap = el("div", "gv-title-wrap");
    if (opts.icon) wrap.appendChild(el("div", "gv-logo", opts.icon));
    var txt = el("div", "gv-title-txt");
    var hRow = el("div");
    hRow.style.cssText = "display:flex;align-items:center;gap:8px";
    hRow.appendChild(el("h4", "", opts.title || "GameVault"));
    if (opts.badge) {
      hRow.appendChild(el("span", "logo-badge ix-badge ix-badge--primary ix-badge--mono", opts.badge));
    }
    txt.appendChild(hRow);
    if (opts.subtitle) txt.appendChild(el("small", "", opts.subtitle));
    wrap.appendChild(txt);
    head.appendChild(wrap);
    head.appendChild(el("span", "gv-spacer"));
    var actWrap = el("div", "nav-actions");
    (opts.actions || []).forEach(function (a) {
      var cls = "gv-btn" + (a.primary ? " gv-btn-primary" : "") + (a.danger ? " gv-btn-danger" : "");
      var b = btnEl(a.label, cls, a.disabled ? null : a.onClick, a.title);
      if (a.disabled) b.disabled = true;
      actWrap.appendChild(b);
    });
    head.appendChild(actWrap);
    page.appendChild(head);
    return head;
  }

  function emptyState(container, title, detail) {
    var box = el("div", "ix-empty gv-empty");
    var iconBox = el("div", "ix-empty__icon");
    iconBox.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4m-2-2v4m7-2h.01m3 0h.01"/></svg>';
    box.appendChild(iconBox);
    if (title) box.appendChild(el("strong", "ix-empty__title", title));
    var p = el("span", "ix-empty__description", detail || "");
    p.style.display = "block";
    box.appendChild(p);
    container.appendChild(box);
    return box;
  }

  function searchWrapEl(input, placeholder, onClear) {
    var wrap = el("div", "search-wrap ix-search gv-search-wrap");
    wrap.style.flex = "1 1 220px";
    var icon = el("span", "ix-input-wrap__leading ix-search__icon");
    icon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
    wrap.appendChild(icon);
    input.placeholder = placeholder || "";
    input.classList.add("ix-input", "ix-search__input");
    wrap.appendChild(input);
    var clear = el("button", "ix-icon-btn ix-icon-btn--sm ix-search__clear");
    clear.type = "button";
    clear.title = "Borrar";
    clear.setAttribute("aria-label", "Borrar texto");
    clear.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    clear.style.display = input.value ? "" : "none";
    clear.addEventListener("click", function () {
      input.value = "";
      clear.style.display = "none";
      if (onClear) onClear();
      input.focus();
    });
    input.addEventListener("input", function () {
      clear.style.display = input.value ? "" : "none";
    });
    wrap.appendChild(clear);
    return wrap;
  }

  function skeletonRows(container, n) {
    for (var i = 0; i < (n || 4); i++) {
      var sk = el("div", "gv-skel");
      container.appendChild(sk);
    }
  }

  var renderToken = 0;

  function renderPage(root) {
    resolveHostUi(api);
    ensureStyles();
    pageRoot = root;
    if (unmount) {
      try { unmount(root); } catch (e) {}
    }
    root.innerHTML = "";
    var token = ++renderToken;
    var done = false;
    ensureGames(function () {
      if (token !== renderToken || done) return;
      done = true;
      var page = el("div", "gv-page");
      root.appendChild(page);
      try {
        if (state.view === "search") renderSearch(page);
        else if (state.view === "detail") renderDetail(page);
        else if (state.view === "picker") renderPicker(page);
        else if (state.view === "amatch") renderAMatch(page);
        else if (state.view === "settings") renderSettings(page);
        else renderLibrary(page);
      } catch (err) {
        console.error("[GameVault] render", err);
        page.innerHTML = "";
        emptyState(page, "No se pudo pintar la vista", String((err && err.message) || err));
      }
    });
  }

  function go(view) {
    if (unmount && pageRoot) {
      try { unmount(pageRoot); } catch (e) {}
    }
    state.view = view;
    rerender();
  }

  // ---------- biblioteca ----------

  function libraryList() {
    var games = gamesCache || [];
    var q = normStr(state.libQuery);
    var list = games.filter(function (g) {
      if (state.statusFilter !== "all" && g.status !== state.statusFilter) return false;
      if (state.onlyWithSources && !(g.sources || []).length) return false;
      if (q) {
        var matchTitle = normStr(g.name).indexOf(q) >= 0;
        var matchDev = g.developer && normStr(g.developer).indexOf(q) >= 0;
        var matchGenre = (g.genres || []).some(function (gen) { return normStr(gen).indexOf(q) >= 0; });
        if (!matchTitle && !matchDev && !matchGenre) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (state.sortBy === "name") return a.name.localeCompare(b.name);
      if (state.sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
    return list;
  }

  function LibraryToolbarComponent(props) {
    var h = React.createElement;
    var [libQuery, setLibQuery] = React.useState(state.libQuery || "");
    var [sortBy, setSortBy] = React.useState(state.sortBy || "recent");
    var [onlyLinks, setOnlyLinks] = React.useState(!!state.onlyWithSources);

    function onQuery(v) {
      setLibQuery(v);
      state.libQuery = v;
      props.onFilterChange();
    }

    function onClear() {
      setLibQuery("");
      state.libQuery = "";
      props.onFilterChange();
    }

    function onSort(v) {
      setSortBy(v);
      state.sortBy = v;
      props.onFilterChange();
    }

    function onToggleLinks() {
      var next = !onlyLinks;
      setOnlyLinks(next);
      state.onlyWithSources = next;
      props.onFilterChange();
    }

    var ButtonComp = (uiKit && uiKit.Button) || "button";
    var SearchInputComp = (uiKit && uiKit.SearchInput) || null;

    return h(
      "div",
      { className: "gv-toolbar", style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
      // 1. Buscador interactivo del catálogo
      SearchInputComp
        ? h(
            "div",
            { style: { flex: "1 1 240px", minWidth: "200px" } },
            h(SearchInputComp, {
              value: libQuery,
              onChange: onQuery,
              onClear: onClear,
              placeholder: "Filtrar por juego del catálogo…",
              className: "gv-lib-search-input",
            })
          )
        : null,
      // 2. Selector de ordenación ("Recientes", "A-Z", "Rating")
      h(
        "select",
        {
          className: "ix-select gv-select",
          value: sortBy,
          onChange: function (e) { onSort(e.target.value); },
          "aria-label": "Ordenar catálogo",
          style: { flexShrink: 0 },
        },
        h("option", { value: "recent" }, "Recientes"),
        h("option", { value: "name" }, "A-Z"),
        h("option", { value: "rating" }, "Rating")
      ),
      // 3. Botón "Con enlace" (filtros de catálogo)
      h(
        ButtonComp,
        {
          variant: onlyLinks ? "primary" : "secondary",
          size: "sm",
          onClick: onToggleLinks,
          className: onlyLinks ? "active" : "",
          style: { flexShrink: 0 },
        },
        rLabel(onlyLinks ? "✓ Con enlace" : "🔗 Con enlace")
      )
    );
  }

  function renderLibrary(page) {
    var games = gamesCache || [];
    var withSrc = games.filter(function (g) { return (g.sources || []).length > 0; }).length;

    headerBar(page, {
      icon: "🎮",
      title: "GameVault",
      badge: "VAULT",
      subtitle: games.length + (games.length === 1 ? " juego" : " juegos") + " · " + withSrc + " con fuentes",
      actions: [
        { label: "⚙ Ajustes", onClick: function () { go("settings"); } },
        { label: "⚡ Auto-match", onClick: function () {
          var idxs = getSources();
          if (!idxs.length) { toast("Importa fuentes en IndexLy primero", "warning"); return; }
          if (!state.am) {
            state.am = {
              indexId: null, items: [], running: false, done: false, stopping: false,
              progress: 0, total: 0, limit: 100, onlyLinks: false, includeExisting: false,
            };
          }
          go("amatch");
        } },
        { label: "＋ Manual", onClick: function () { openManualAdd(); } },
        { label: "＋ Buscar juegos", primary: true, onClick: function () { state.searchQuery = ""; go("search"); } },
      ],
    });

    var toolbarHost = el("div", "gv-toolbar-host");
    page.appendChild(toolbarHost);

    if (React && uiKit && typeof mount === "function" && uiKit.SearchInput) {
      mount(
        React.createElement(LibraryToolbarComponent, {
          onFilterChange: function () {
            fillList();
          },
        }),
        toolbarHost
      );
    } else {
      var toolbar = el("div", "gv-toolbar");
      var input = el("input", "gv-input");
      input.type = "search";
      input.value = state.libQuery;
      input.setAttribute("aria-label", "Buscar en tu vault");
      input.addEventListener("input", function () { state.libQuery = input.value; fillList(); });
      toolbar.appendChild(searchWrapEl(input, "Filtrar por juego del catálogo…", function () { state.libQuery = ""; fillList(); }));

      var sel = document.createElement("select");
      sel.className = "ix-select gv-select";
      sel.setAttribute("aria-label", "Ordenar por");
      [["recent", "Recientes"], ["name", "A-Z"], ["rating", "Rating"]].forEach(function (o) {
        var op = document.createElement("option");
        op.value = o[0];
        op.textContent = o[1];
        if (state.sortBy === o[0]) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener("change", function () { state.sortBy = sel.value; fillList(); });
      toolbar.appendChild(sel);

      var onlyBtn = el("button", "chip gv-chip" + (state.onlyWithSources ? " active" : ""), state.onlyWithSources ? "✓ Con enlace" : "🔗 Con enlace");
      onlyBtn.type = "button";
      onlyBtn.addEventListener("click", function () {
        state.onlyWithSources = !state.onlyWithSources;
        onlyBtn.classList.toggle("active", state.onlyWithSources);
        setLabel(onlyBtn, state.onlyWithSources ? "✓ Con enlace" : "🔗 Con enlace");
        fillList();
      });
      toolbar.appendChild(onlyBtn);
      toolbarHost.appendChild(toolbar);
    }

    var chips = el("div", "controls filter-chips gv-head");
    function chip(id, label, count) {
      var c = el("button", "chip gv-chip" + (state.statusFilter === id ? " active" : ""));
      c.type = "button";
      c.appendChild(document.createTextNode(label));
      var n = el("span", "gv-chip-n ix-tab__count", String(count));
      c.appendChild(n);
      c.addEventListener("click", function () { state.statusFilter = id; rerender(); });
      return c;
    }
    chips.appendChild(chip("all", "Todos", games.length));
    STATUSES.forEach(function (st) {
      var n = games.filter(function (g) { return g.status === st.id; }).length;
      chips.appendChild(chip(st.id, st.label, n));
    });
    page.appendChild(chips);

    var grid = el("div", "gv-grid");
    page.appendChild(grid);

    var PAGE_SIZE = 60;
    var renderedCount = 0;
    var currentObserver = null;

    function renderCard(g) {
      var card = el("article", "ix-card ix-card--interactive gv-card");
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", g.name + " — ver ficha");

      var posterWrap = el("div", "gv-poster-wrap");
      posterWrap.appendChild(posterEl(g));
      if (g.rating != null) posterWrap.appendChild(el("span", "gv-rating-pill ix-badge ix-badge--warning ix-badge--mono", "★ " + g.rating));

      var quick = el("button", "gv-card-action", "⬇");
      quick.type = "button";
      quick.title = "Añadir fuentes a este juego";
      quick.setAttribute("aria-label", "Añadir fuentes a " + g.name);
      quick.addEventListener("click", function (e) {
        e.stopPropagation();
        state.gameId = g.id;
        openPicker();
      });
      posterWrap.appendChild(quick);
      card.appendChild(posterWrap);

      var body = el("div", "gv-card-body");
      body.appendChild(el("div", "gv-card-name", g.name));
      var subBits = [];
      if (g.released) subBits.push(String(g.released).slice(0, 4));
      if (g.developer) subBits.push(g.developer);
      if (!subBits.length && g.genres && g.genres.length) subBits.push(g.genres[0]);
      if (subBits.length) body.appendChild(el("div", "gv-card-sub", subBits.join(" · ")));
      card.appendChild(body);

      var foot = el("div", "gv-card-foot");
      var nSrc = (g.sources || []).length;
      foot.appendChild(el("span", "gv-src-stat ix-badge ix-badge--mono" + (nSrc ? " has ix-badge--primary" : ""), nSrc === 1 ? "⬇ 1 fuente" : "⬇ " + nSrc + " fuentes"));
      var st = statusOf(g.status);
      var stBadge = el("span", "ix-badge gv-status-badge", "");
      stBadge.style.cssText = "margin-left:auto;border-color:color-mix(in srgb," + st.color + " 30%,transparent);background:color-mix(in srgb," + st.color + " 8%,transparent);color:" + st.color;
      var dot = el("span", "ix-badge__dot gv-status-dot");
      dot.style.background = st.color;
      stBadge.appendChild(dot);
      var lbl = el("span", "gv-status-lbl", st.label);
      lbl.style.color = st.color;
      stBadge.appendChild(lbl);
      foot.appendChild(stBadge);
      card.appendChild(foot);

      var open = function () { state.gameId = g.id; go("detail"); };
      card.addEventListener("click", open);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      return card;
    }

    function fillList(appendOnly) {
      if (currentObserver) {
        try { currentObserver.disconnect(); } catch (e) {}
        currentObserver = null;
      }
      var list = libraryList();
      if (!appendOnly) {
        grid.innerHTML = "";
        renderedCount = 0;
      } else {
        var oldSentinel = grid.querySelector(".gv-load-more-wrap");
        if (oldSentinel) oldSentinel.remove();
      }

      if (!list.length) {
        if (!games.length) {
          emptyState(grid, "Tu vault está vacía", "Busca juegos en GameDB, añádelos a mano o usa Auto-match sobre una de tus fuentes.");
          if (grid.firstChild) grid.firstChild.style.gridColumn = "1/-1";
        } else {
          var e = emptyState(grid, "Nada coincide", "Prueba con otro filtro o borra la búsqueda.");
          e.style.gridColumn = "1/-1";
        }
        return;
      }

      var nextBatch = list.slice(renderedCount, renderedCount + PAGE_SIZE);
      var frag = document.createDocumentFragment();
      nextBatch.forEach(function (g) {
        frag.appendChild(renderCard(g));
      });
      grid.appendChild(frag);
      renderedCount += nextBatch.length;

      if (renderedCount < list.length) {
        var loadWrap = el("div", "gv-load-more-wrap");
        var remaining = list.length - renderedCount;
        var info = el("div", "gv-load-info", "Mostrando " + renderedCount + " de " + list.length + " juegos");
        info.style.cssText = "font-size:12px;color:var(--color-text-tertiary,#64748b);font-family:var(--font-mono,monospace);";
        loadWrap.appendChild(info);

        var loadBtn = el("button", "ix-btn ix-btn--secondary gv-btn", "Cargar más (" + remaining + " restantes)");
        loadBtn.type = "button";
        loadBtn.addEventListener("click", function () {
          fillList(true);
        });
        loadWrap.appendChild(loadBtn);
        grid.appendChild(loadWrap);

        if (typeof IntersectionObserver !== "undefined") {
          currentObserver = new IntersectionObserver(function (entries) {
            if (entries[0] && entries[0].isIntersecting) {
              if (currentObserver) {
                try { currentObserver.disconnect(); } catch (e) {}
                currentObserver = null;
              }
              fillList(true);
            }
          }, { rootMargin: "350px" });
          currentObserver.observe(loadWrap);
        }
      }
    }
    fillList();
  }

  // ---------- buscar juegos ----------

  function GameDBSearchComponent(props) {
    var h = React.createElement;
    var [query, setQuery] = React.useState(state.searchQuery || "");
    var [loading, setLoading] = React.useState(false);
    var [hits, setHits] = React.useState([]);
    var [searchedQuery, setSearchedQuery] = React.useState("");
    var [hasSearched, setHasSearched] = React.useState(false);
    var [error, setError] = React.useState(null);
    var [addingId, setAddingId] = React.useState(null);
    var [vaultVer, setVaultVer] = React.useState(0);
    var timerRef = React.useRef(null);
    var seqRef = React.useRef(0);

    function executeSearch(q, immediate) {
      var raw = (q != null ? q : query) || "";
      var trimmed = raw.trim();
      state.searchQuery = trimmed;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!trimmed) {
        setHits([]);
        setLoading(false);
        setError(null);
        setHasSearched(false);
        setSearchedQuery("");
        return;
      }

      setLoading(true);
      setError(null);
      setHasSearched(true);
      setSearchedQuery(trimmed);
      var mySeq = ++seqRef.current;

      gdbSearch(trimmed, 30).then(function (rawHits) {
        if (mySeq !== seqRef.current) return;
        if (!rawHits || !rawHits.length) {
          setHits([]);
          setLoading(false);
          return;
        }

        // Cargar ficha completa para los primeros 12 resultados para mostrar carátula, rating y fecha
        var topPromises = rawHits.slice(0, 12).map(function (h) {
          return gdbGame(h.id).then(
            function (j) { return { hit: h, detail: j ? mapGameDB(j) : null }; },
            function () { return { hit: h, detail: null }; }
          );
        });

        return Promise.all(topPromises).then(function (resolved) {
          if (mySeq !== seqRef.current) return;
          var full = resolved.concat(
            rawHits.slice(12).map(function (h) { return { hit: h, detail: null }; })
          );
          setHits(full);
          setLoading(false);
        });
      }).catch(function (err) {
        if (mySeq !== seqRef.current) return;
        setHits([]);
        setLoading(false);
        setError((err && err.message) || "No se pudo consultar GameDB");
      });
    }

    function handleInputChange(val) {
      setQuery(val);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!val.trim()) {
        executeSearch("", false);
        return;
      }
      timerRef.current = setTimeout(function () {
        executeSearch(val, false);
      }, 360);
    }

    function handleClear() {
      setQuery("");
      executeSearch("", true);
    }

    function handleAdd(item) {
      var hObj = item.hit;
      var dObj = item.detail;
      setAddingId(hObj.id);

      var finish = function (mappedData) {
        var d = mappedData || (dObj ? dObj : { name: hObj.name, gdbId: String(hObj.id), genres: [] });
        var rec = addGdbGameMapped(d, []);
        saveGames();
        setVaultVer(function (v) { return v + 1; });
        setAddingId(null);
        refreshHost();
        toast("«" + (rec ? rec.name : d.name) + "» añadido a tu colección", "success");
      };

      if (dObj) {
        finish(dObj);
      } else {
        gdbGame(hObj.id).then(function (j) {
          finish(j ? mapGameDB(j) : null);
        }).catch(function () {
          finish(null);
        });
      }
    }

    React.useEffect(function () {
      if (state.searchQuery) {
        executeSearch(state.searchQuery, true);
      }
      return function () {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    var ButtonComp = (uiKit && uiKit.Button) || "button";
    var SearchInputComp = (uiKit && uiKit.SearchInput) || null;
    var BadgeComp = (uiKit && uiKit.Badge) || "span";
    var CardComp = (uiKit && uiKit.Card) || "div";
    var CardTitleComp = (uiKit && uiKit.CardTitle) || "strong";
    var EmptyStateComp = (uiKit && uiKit.EmptyState) || null;
    var SpinnerComp = (uiKit && uiKit.Spinner) || null;
    var CalloutComp = (uiKit && uiKit.Callout) || null;

    var suggestions = ["Elden Ring", "Hades", "The Witcher 3", "Zelda", "Super Mario", "GTA V", "Cyberpunk 2077", "Hollow Knight", "Celeste"];

    return h(
      "div",
      { className: "gv-search-react-view", style: { display: "flex", flexDirection: "column", gap: "16px", width: "100%" } },
      // Cabecera
      h(
        "div",
        { className: "gv-head", style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" } },
        h(
          "div",
          { className: "gv-title-wrap", style: { display: "flex", alignItems: "center", gap: "12px" } },
          h("div", { className: "gv-logo" }, rLabel("🔎")),
          h(
            "div",
            { className: "gv-title-txt" },
            h("h4", null, "Buscar juegos en GameDB"),
            h("small", null, "Datos abiertos de IGDB publicados por LizardByte · Sin límites ni claves")
          )
        ),
        h(
          ButtonComp,
          {
            variant: "secondary",
            size: "sm",
            onClick: props.onBack,
          },
          rLabel("← Volver al catálogo")
        )
      ),

      // Barra de búsqueda con SearchInput y Button
      h(
        "div",
        { className: "gv-search-box", style: { display: "flex", gap: "10px", alignItems: "center", width: "100%" } },
        h(
          "div",
          { style: { flex: 1 } },
          SearchInputComp
            ? h(SearchInputComp, {
                value: query,
                onChange: handleInputChange,
                onClear: handleClear,
                placeholder: "Buscar en más de 370.000 juegos (ej: Elden Ring, Hades, Zelda, Mario...)",
                autoFocus: true,
                onKeyDown: function (e) {
                  if (e.key === "Enter") executeSearch(query, true);
                },
              })
            : h("input", {
                type: "search",
                value: query,
                className: "ix-input gv-input",
                placeholder: "Buscar en más de 370.000 juegos…",
                onChange: function (e) { handleInputChange(e.target.value); },
                onKeyDown: function (e) { if (e.key === "Enter") executeSearch(query, true); },
              })
        ),
        h(
          ButtonComp,
          {
            variant: "primary",
            loading: loading,
            onClick: function () { executeSearch(query, true); },
            style: { flexShrink: 0 },
          },
          "Buscar"
        )
      ),

      // Sugerencias rápidas cuando no se ha buscado aún
      (!hasSearched && !loading)
        ? h(
            "div",
            { className: "gv-suggestions-row", style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
            h("span", { style: { fontSize: "11.5px", color: "var(--color-text-tertiary, #64748b)" } }, "Populares:"),
            suggestions.map(function (sug) {
              return h(
                "button",
                {
                  key: sug,
                  type: "button",
                  className: "chip gv-chip",
                  style: { cursor: "pointer", height: "26px", fontSize: "11px" },
                  onClick: function () {
                    setQuery(sug);
                    executeSearch(sug, true);
                  },
                },
                sug
              );
            })
          )
        : null,

      // Estado de carga
      (loading && hits.length === 0)
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "40px 0" } },
            SpinnerComp ? h(SpinnerComp, { size: "lg", label: "Consultando GameDB…" }) : h("div", null, "Cargando…"),
            h("span", { style: { fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" } }, "Consultando GameDB para «" + (searchedQuery || query) + "»…")
          )
        : null,

      // Estado de error
      (!loading && error)
        ? (CalloutComp
            ? h(
                CalloutComp,
                { variant: "danger", title: "Error consultando GameDB" },
                error,
                h(
                  "div",
                  { style: { marginTop: "10px" } },
                  h(ButtonComp, { size: "sm", onClick: function () { executeSearch(query, true); } }, "Reintentar")
                )
              )
            : h("div", { className: "ix-callout ix-callout--danger" }, error))
        : null,

      // Estado inicial (sin búsqueda)
      (!loading && !hasSearched && !error)
        ? (EmptyStateComp
            ? h(EmptyStateComp, {
                title: "Encuentra cualquier juego en GameDB",
                description: "Escribe un título en el buscador para consultar más de 370.000 juegos de IGDB con carátulas, desarrolladores, sinopsis, notas y fecha de lanzamiento.",
              })
            : h("div", { className: "gv-empty" }, "Escribe un título para buscar en GameDB."))
        : null,

      // Sin resultados
      (!loading && hasSearched && !error && hits.length === 0)
        ? (EmptyStateComp
            ? h(EmptyStateComp, {
                title: "Sin resultados para «" + searchedQuery + "»",
                description: "No encontramos ningún juego con ese nombre en GameDB. Prueba con menos palabras o añade el juego manualmente a tu colección.",
                actions: h(ButtonComp, { variant: "secondary", onClick: props.onAddManual }, rLabel("＋ Añadir juego manualmente")),
              })
            : h("div", { className: "gv-empty" }, "Sin resultados para «" + searchedQuery + "»."))
        : null,

      // Lista de resultados
      (hits.length > 0)
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "10px" } },
            // Barra de conteo
            h(
              "div",
              { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px" } },
              h(
                BadgeComp,
                { variant: "neutral" },
                hits.length + (hits.length === 1 ? " resultado en GameDB" : " resultados en GameDB")
              ),
              h("span", { style: { fontSize: "11px", color: "var(--color-text-tertiary, #64748b)" } }, "Pulsa «＋ Añadir» para guardar en tu vault")
            ),
            // Tarjetas de resultados
            h(
              "div",
              {
                className: "gv-results gv-search-results",
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  maxHeight: "none",
                  overflow: "visible",
                  width: "100%",
                  boxSizing: "border-box",
                },
              },
              hits.map(function (item) {
                var hit = item.hit;
                var detail = item.detail;
                var mapped = detail || { name: hit.name, gdbId: String(hit.id), genres: [] };
                var inVault = (mapped.gdbId != null && !!vaultIndex.byGdb[String(mapped.gdbId)]) ||
                              !!vaultIndex.byName[normStr(mapped.name)];
                var isAdding = addingId === hit.id;
                var coverSrc = mapped.coverUrl || mapped.imageUrl;

                return h(
                  "div",
                  {
                    key: hit.id,
                    className: "ix-card ix-card--interactive gv-res-card",
                    style: {
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: "16px",
                      padding: "12px 18px",
                      minHeight: "86px",
                      boxSizing: "border-box",
                      borderRadius: "var(--radius-xl, 14px)",
                      background: "var(--color-surface, #10151f)",
                      border: "1px solid var(--color-border, #1a2332)",
                      overflow: "hidden",
                      width: "100%",
                    },
                  },
                  // Carátula / imagen
                  h(
                    "div",
                    {
                      style: {
                        width: "56px",
                        height: "76px",
                        borderRadius: "8px",
                        overflow: "hidden",
                        flexShrink: 0,
                        background: "var(--color-bg, #070a12)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      },
                    },
                    coverSrc
                      ? h("img", {
                          src: coverSrc,
                          alt: mapped.name,
                          style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
                          loading: "lazy",
                        })
                      : h(
                          "div",
                          {
                            style: {
                              width: "100%",
                              height: "100%",
                              display: "grid",
                              placeItems: "center",
                              background: gradientFor(mapped.name),
                              fontSize: "22px",
                              fontWeight: "bold",
                              color: "#fff",
                            },
                          },
                          mapped.name.charAt(0).toUpperCase()
                        )
                  ),
                  // Información central
                  h(
                    "div",
                    {
                      style: {
                        flex: "1 1 0%",
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "5px",
                        justifyContent: "center",
                      },
                    },
                    h(
                      "div",
                      { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
                      h(
                        "span",
                        {
                          style: {
                            fontSize: "15px",
                            fontWeight: 700,
                            color: "var(--color-text, #f1f5f9)",
                            lineHeight: 1.25,
                            letterSpacing: "-0.01em",
                          },
                        },
                        mapped.name
                      ),
                      mapped.released
                        ? h(BadgeComp, { variant: "neutral" }, String(mapped.released).slice(0, 4))
                        : null,
                      mapped.rating != null
                        ? h(BadgeComp, { variant: "warning" }, rLabel("★ " + mapped.rating))
                        : null,
                      mapped.metacritic != null
                        ? h(BadgeComp, { variant: "primary" }, "MC " + mapped.metacritic)
                        : null
                    ),
                    h(
                      "div",
                      {
                        style: {
                          fontSize: "12px",
                          color: "var(--color-text-secondary, #94a3b8)",
                          display: "flex",
                          gap: "6px",
                          flexWrap: "wrap",
                          alignItems: "center",
                        },
                      },
                      mapped.developer
                        ? h("span", { style: { fontWeight: 600, color: "var(--color-text, #f1f5f9)" } }, mapped.developer)
                        : null,
                      mapped.developer && mapped.genres && mapped.genres.length ? h("span", null, "·") : null,
                      (mapped.genres || []).slice(0, 3).map(function (g, idx) {
                        return h(
                          "span",
                          { key: g, style: { color: "var(--color-text-tertiary, #64748b)" } },
                          g + (idx < Math.min((mapped.genres || []).length, 3) - 1 ? "," : "")
                        );
                      })
                    ),
                    mapped.description
                      ? h(
                          "div",
                          {
                            style: {
                              fontSize: "12px",
                              color: "var(--color-text-tertiary, #64748b)",
                              lineHeight: 1.45,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              maxHeight: "36px",
                            },
                          },
                          mapped.description
                        )
                      : null
                  ),
                  // Acciones en la derecha
                  h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        flexShrink: 0,
                        marginLeft: "auto",
                      },
                    },
                    mapped.gdbUrl
                      ? h(
                          ButtonComp,
                          {
                            variant: "ghost",
                            size: "sm",
                            onClick: function () { openExternal(mapped.gdbUrl); },
                            title: "Ver ficha en IGDB",
                            style: { color: "var(--color-text-secondary, #94a3b8)" },
                          },
                          "IGDB ↗"
                        )
                      : null,
                    h(
                      ButtonComp,
                      {
                        variant: inVault ? "secondary" : "primary",
                        size: "sm",
                        disabled: inVault || isAdding,
                        loading: isAdding,
                        onClick: function () { handleAdd(item); },
                        style: { minWidth: "90px", fontWeight: 600 },
                      },
                      rLabel(inVault ? "✓ En vault" : "＋ Añadir")
                    )
                  )
                );
              })
            )
          )
        : null
    );
  }

  var searchTimer = null;

  function renderSearch(page) {
    if (React && uiKit && typeof mount === "function" && uiKit.SearchInput) {
      var reactRoot = el("div", "gv-search-react-host");
      page.appendChild(reactRoot);
      mount(
        React.createElement(GameDBSearchComponent, {
          onBack: function () { go("library"); },
          onAddManual: function () { openManualAdd(); },
        }),
        reactRoot
      );
      return;
    }

    headerBar(page, {
      icon: "🔎",
      title: "Buscar juegos",
      subtitle: "GameDB · datos de IGDB publicados por LizardByte",
      actions: [{ label: "← Volver", onClick: function () { go("library"); } }],
    });

    var searchSection = el("div", "gv-search-section");
    var searchBox = el("div", "gv-search-box");
    var input = el("input", "gv-input");
    input.type = "search";
    input.value = state.searchQuery;
    input.setAttribute("aria-label", "Buscar juegos en GameDB");
    
    var searchWrap = searchWrapEl(input, "Buscar en más de 370.000 juegos (ej: Elden Ring, Hades, Hollow Knight…)", function () {
      doSearch("", false);
    });
    searchWrap.classList.add("gv-search-input-wrap");
    searchBox.appendChild(searchWrap);

    var goBtn = btnEl("Buscar", "gv-btn-primary gv-search-btn", function () {
      doSearch(input.value.trim(), true);
    });
    searchBox.appendChild(goBtn);
    searchSection.appendChild(searchBox);
    page.appendChild(searchSection);

    var status = el("div", "gv-head");
    page.appendChild(status);
    var results = el("div", "gv-results gv-search-results");
    page.appendChild(results);

    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }

    input.addEventListener("input", function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { doSearch(input.value.trim(), false); }, 380);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
        doSearch(input.value.trim(), true);
      }
    });

    function setStatus(text, kind) {
      status.innerHTML = "";
      if (!text) return;
      var n = el("div", "gv-notice ix-callout" + (kind ? " ix-callout--" + (kind === "ok" ? "success" : "danger") : ""), text);
      n.style.flex = "1";
      status.appendChild(n);
    }

    function rowFor(hit, detail) {
      var mapped = detail ? mapGameDB(detail) : { name: hit.name, gdbId: String(hit.id), genres: [] };
      var inVault = (mapped.gdbId != null && !!vaultIndex.byGdb[String(mapped.gdbId)]) ||
                    !!vaultIndex.byName[normStr(mapped.name)];
      var row = el("div", "ix-card ix-card--interactive gv-res-row");
      row.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;gap:16px !important;padding:12px 18px !important;border-radius:var(--radius-xl,14px) !important;min-height:86px !important;width:100% !important;box-sizing:border-box !important;";

      var imgWrap = el("div");
      imgWrap.style.cssText = "width:56px;height:76px;border-radius:8px;overflow:hidden;flex-shrink:0;background:var(--color-bg,#070a12);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);";
      var coverSrc = mapped.coverUrl || mapped.imageUrl;

      if (coverSrc) {
        var img = document.createElement("img");
        img.className = "gv-res-img";
        img.src = coverSrc;
        img.alt = "";
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
        img.loading = "lazy";
        imgWrap.appendChild(img);
      } else {
        var ph = el("div");
        ph.style.cssText = "width:100%;height:100%;display:grid;place-items:center;background:" + gradientFor(mapped.name) + ";font-size:22px;font-weight:bold;color:#fff;";
        ph.textContent = mapped.name.charAt(0).toUpperCase();
        imgWrap.appendChild(ph);
      }
      row.appendChild(imgWrap);

      var info = el("div", "gv-res-info");
      info.style.cssText = "flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;gap:3px !important;";
      info.appendChild(el("strong", "", mapped.name));
      var bits = [];
      if (mapped.released) bits.push(fmtDate(mapped.released));
      if (mapped.rating != null) bits.push("★ " + mapped.rating);
      if (mapped.metacritic != null) bits.push("MC " + mapped.metacritic);
      if (mapped.developer) bits.push(mapped.developer);
      if (mapped.genres && mapped.genres.length) bits.push(mapped.genres.slice(0, 2).join(", "));
      info.appendChild(el("small", "", bits.length ? bits.join(" · ") : "Cargando ficha…"));
      row.appendChild(info);

      var actions = el("div");
      actions.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto;";

      if (mapped.gdbUrl) {
        actions.appendChild(btnEl("IGDB ↗", "", function () { openExternal(mapped.gdbUrl); }, "Abrir ficha en IGDB"));
      }

      var add = btnEl(inVault ? "✓ En vault" : "＋ Añadir", inVault ? "" : "gv-btn-primary");
      if (inVault) add.disabled = true;
      else add.addEventListener("click", function () {
        add.disabled = true;
        add.textContent = "Añadiendo…";
        var finish = function (j) {
          var d = j ? mapGameDB(j) : mapped;
          var rec = addGdbGameMapped(d, []);
          saveGames();
          refreshHost();
          setLabel(add, "✓ En vault");
          toast("«" + (rec ? rec.name : mapped.name) + "» añadido a la vault", "success");
        };
        if (detail) finish(detail);
        else gdbGame(mapped.gdbId).then(finish).catch(function () { finish(null); });
      });
      actions.appendChild(add);
      row.appendChild(actions);
      results.appendChild(row);
    }

    function doSearch(q, immediate) {
      state.searchQuery = q;
      var mySeq = ++state.searchSeq;
      results.innerHTML = "";
      if (!q) {
        setStatus("Escribe un término para buscar en más de 370.000 juegos.", null);
        return;
      }
      setStatus("Buscando «" + q + "» en GameDB…", null);
      skeletonRows(results, 4);

      gdbSearch(q, 25).then(function (hits) {
        if (mySeq !== state.searchSeq) return;
        results.innerHTML = "";
        if (!hits.length) {
          setStatus("Sin resultados para «" + q + "». Prueba con menos palabras.", null);
          return;
        }
        setStatus(hits.length + (hits.length === 1 ? " resultado" : " resultados"), null);
        var top = hits.slice(0, 12).map(function (h) {
          return gdbGame(h.id).then(function (j) { return { hit: h, detail: j || null }; }, function () { return { hit: h, detail: null }; });
        });
        return Promise.all(top).then(function (rows) {
          if (mySeq !== state.searchSeq) return;
          rows.forEach(function (r) { rowFor(r.hit, r.detail); });
          hits.slice(12).forEach(function (h) { rowFor(h, null); });
        });
      }).catch(function (err) {
        if (mySeq !== state.searchSeq) return;
        results.innerHTML = "";
        setStatus("No se pudo consultar GameDB: " + ((err && err.message) || "error de red"), "err");
      });
    }

    if (state.searchQuery) doSearch(state.searchQuery, true);
    else setStatus("Escribe un término para buscar en más de 370.000 juegos.", null);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  }

  // ---------- ficha ----------

  function openPicker(preferredGameId) {
    if (preferredGameId) state.gameId = preferredGameId;
    var g = currentGame();
    state.picks = {};
    state.pickQuery = g ? (cleanTitle(g.name).name || g.name) : "";
    state.pickIndexId = null;
    state.pickLimit = PICK_RENDER_LIMIT;
    state.pickLoading = {};
    state.pickErrors = {};
    go("picker");
  }

  function refreshFromGdb(game, btn) {
    if (!game.gdbId) { toast("Este juego no está vinculado a GameDB", "info"); return; }
    if (btn) { btn.disabled = true; btn.textContent = "Actualizando…"; }
    gdbGame(game.gdbId).then(function (j) {
      if (!j) throw new Error("GameDB no devolvió la ficha");
      mergeMappedInto(game, mapGameDB(j), true);
      return saveGames();
    }).then(function () {
      toast("Ficha actualizada desde GameDB", "success");
      rerender();
    }).catch(function (err) {
      toast("No se pudo actualizar: " + ((err && err.message) || "error"), "error");
      if (btn) { btn.disabled = false; setLabel(btn, "↻ Actualizar ficha"); }
    });
  }

  function renderDetail(page) {
    var g = currentGame();
    if (!g) { go("library"); return; }

    headerBar(page, {
      icon: "🎮",
      title: g.name,
      subtitle: (g.sources || []).length + ((g.sources || []).length === 1 ? " fuente enlazada" : " fuentes enlazadas"),
      actions: [
        { label: "← Volver", onClick: function () { go("library"); } },
        { label: "＋ Fuente", onClick: openPicker },
        { label: "↻ Actualizar ficha", disabled: !g.gdbId, onClick: function (e) { refreshFromGdb(g, e && e.currentTarget); } },
        { label: "Eliminar", danger: true, onClick: function () {
          api.modal({
            title: "Eliminar juego",
            html: "<p>¿Eliminar <strong>" + esc(g.name) + "</strong> de tu vault? Sus fuentes guardadas se perderán (tus índices no se tocan).</p>",
            actions: [
              { label: "Cancelar" },
              { label: "Eliminar", danger: true, onClick: function () {
                gamesCache = (gamesCache || []).filter(function (x) { return x.id !== g.id; });
                saveGames();
                toast("Juego eliminado de la vault", "info");
                go("library");
              } },
            ],
          });
        } },
      ],
    });

    var detail = el("div", "gv-detail");
    page.appendChild(detail);

    function heroCoverPh() {
      var hcp = el("div", "gv-hero-cover-ph");
      hcp.style.background = phBackground(g.name);
      hcp.appendChild(el("span", "gv-poster-initial", (g.name || "?").charAt(0).toUpperCase()));
      return hcp;
    }

    var hero = el("div", "gv-hero");
    if (g.imageUrl) {
      var hb = document.createElement("img");
      hb.className = "gv-hero-img";
      hb.src = g.imageUrl;
      hb.alt = "";
      hb.loading = "lazy";
      hb.decoding = "async";
      hb.addEventListener("error", function () {
        var bhp = el("div", "gv-hero-ph");
        bhp.style.background = phBackground(g.name);
        hb.replaceWith(bhp);
      });
      hero.appendChild(hb);
    } else {
      var bhp0 = el("div", "gv-hero-ph");
      bhp0.style.background = phBackground(g.name);
      bhp0.appendChild(el("span", "gv-poster-initial", (g.name || "?").charAt(0).toUpperCase()));
      hero.appendChild(bhp0);
    }
    hero.appendChild(el("div", "gv-hero-shade"));
    if (g.rating != null) hero.appendChild(el("span", "gv-hero-rating ix-badge ix-badge--warning ix-badge--mono", "★ " + g.rating));
    var hinner = el("div", "gv-hero-inner");
    if (g.coverUrl || g.imageUrl) {
      var hc = document.createElement("img");
      hc.className = "gv-hero-cover";
      hc.src = g.coverUrl || g.imageUrl;
      hc.alt = g.name || "";
      hc.loading = "lazy";
      hc.decoding = "async";
      hc.addEventListener("error", function () { hc.replaceWith(heroCoverPh()); });
      hinner.appendChild(hc);
    } else {
      hinner.appendChild(heroCoverPh());
    }
    var htxt = el("div", "gv-hero-txt");
    htxt.appendChild(el("h2", "gv-title-xl", g.name));
    var hsub = [];
    if (g.released) hsub.push(String(g.released).slice(0, 4));
    if (g.developer) hsub.push(g.developer);
    if (hsub.length) htxt.appendChild(el("div", "gv-hero-sub", hsub.join(" · ")));
    hinner.appendChild(htxt);
    hero.appendChild(hinner);
    detail.appendChild(hero);

    var stats = el("div", "ix-card gv-stats");
    stats.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;justify-content:space-around !important;gap:16px !important;flex-wrap:wrap !important;padding:18px 24px !important;";
    function mkStat(score, lbl, amber) {
      var s = el("div", "ix-stat gv-stat");
      s.style.cssText = "display:flex !important;flex-direction:column !important;align-items:center !important;text-align:center !important;gap:4px !important;flex:1 1 80px !important;min-width:65px !important;";
      s.appendChild(el("div", "ix-stat__value gv-stat-score" + (amber ? " amber" : ""), score));
      s.appendChild(el("div", "ix-stat__label gv-stat-lbl", lbl));
      return s;
    }
    if (g.rating != null) stats.appendChild(mkStat("★ " + g.rating, "IGDB", true));
    if (g.metacritic != null) stats.appendChild(mkStat(String(g.metacritic), "Metacritic", false));
    if (g.released) stats.appendChild(mkStat(String(g.released).slice(0, 4), "Año", false));
    if (g.pegi) stats.appendChild(mkStat("PEGI " + g.pegi, "Edad", false));
    stats.appendChild(mkStat(String((g.sources || []).length), "Fuentes", false));
    detail.appendChild(stats);

    if (((g.genres || []).length) || ((g.platforms || []).length)) {
      var tagRow = el("div", "gv-meta-row");
      (g.genres || []).slice(0, 4).forEach(function (gn) { tagRow.appendChild(el("span", "ix-badge ix-badge--mono gv-tag", gn)); });
      if ((g.platforms || []).length) {
        gdbPlatforms().then(function (map) {
          if (!tagRow.isConnected) return;
          (g.platforms || []).slice(0, 6).forEach(function (pid) {
            tagRow.appendChild(el("span", "ix-badge ix-badge--mono gv-tag", map[pid] || ("Plataforma " + pid)));
          });
        }).catch(function () {});
      }
      detail.appendChild(tagRow);
    }

    var stRow = el("div", "controls filter-chips gv-head");
    stRow.appendChild(el("small", "", "Estado:"));
    STATUSES.forEach(function (s) {
      var c = el("button", "chip gv-chip" + (g.status === s.id ? " active" : ""), s.label);
      c.type = "button";
      c.addEventListener("click", function () {
        g.status = s.id;
        saveGames();
        rerender();
      });
      stRow.appendChild(c);
    });
    detail.appendChild(stRow);

    if (g.description) {
      var dcol = el("div");
      dcol.style.cssText = "display:flex;flex-direction:column;gap:8px;align-items:flex-start";
      var desc = el("p", "gv-desc-full gv-desc-clamp gv-fade", g.description);
      dcol.appendChild(desc);
      if (g.description.length > 420) {
        var moreBtn = el("button", "ix-btn ix-btn--sm ix-btn--secondary gv-more", "Leer más");
        moreBtn.type = "button";
        var expanded = false;
        moreBtn.addEventListener("click", function () {
          expanded = !expanded;
          desc.classList.toggle("gv-desc-clamp", !expanded);
          desc.classList.toggle("gv-fade", !expanded);
          moreBtn.textContent = expanded ? "Leer menos" : "Leer más";
        });
        dcol.appendChild(moreBtn);
      }
      detail.appendChild(dcol);
    } else if (g.gdbId && !g.__enriching) {
      g.__enriching = true;
      gdbGame(g.gdbId).then(function (d) {
        var cur = findGame(g.id);
        if (!cur || !d) return;
        mergeMappedInto(cur, mapGameDB(d), false);
        delete cur.__enriching;
        saveGames();
        if (state.view === "detail" && state.gameId === cur.id) rerender();
      }).catch(function () { g.__enriching = false; });
    }

    if ((g.screenshots || []).length) {
      var shots = el("div", "gv-shots");
      g.screenshots.forEach(function (u) {
        var img = document.createElement("img");
        img.src = u;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("click", function () {
          api.modal({
            title: g.name,
            html: '<img src="' + esc(u) + '" alt="" style="width:100%;border-radius:10px;display:block" />',
            actions: [{ label: "Cerrar" }],
          });
        });
        shots.appendChild(img);
      });
      detail.appendChild(shots);
    }

    if (g.website || g.gdbUrl) {
      var links = el("div", "gv-head");
      if (g.website) links.appendChild(btnEl("Web oficial ↗", "", function () { openExternal(g.website); }));
      if (g.gdbUrl) links.appendChild(btnEl("Ver en IGDB ↗", "", function () { openExternal(g.gdbUrl); }));
      detail.appendChild(links);
    }

    // Fuentes
    var sec = el("div", "ix-card gv-section");
    var st2 = el("div", "ix-card__header gv-section-title");
    st2.appendChild(el("h5", "ix-card__title", "Fuentes de descarga"));
    st2.appendChild(el("span", "ix-badge ix-badge--mono", (g.sources || []).length === 1 ? "1 enlace" : (g.sources || []).length + " enlaces"));
    st2.appendChild(el("span", "gv-spacer"));
    st2.appendChild(btnEl("＋ Añadir fuentes", "gv-btn-primary", openPicker));
    sec.appendChild(st2);

    var secBody = el("div", "ix-card__body", "");
    secBody.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:14px 18px";
    sec.appendChild(secBody);

    if (!(g.sources || []).length) {
      emptyState(secBody, "Sin fuentes todavía", "«Añadir fuentes» te deja elegir elementos de tus propios índices de IndexLy.");
    } else {
      g.sources.forEach(function (s) {
        var row = el("div", "ix-list-item gv-src-row");
        row.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;gap:12px !important;padding:12px 16px !important;border-radius:var(--radius-md,10px) !important;box-sizing:border-box !important;";
        var dot = el("span", "ix-badge__dot");
        dot.style.cssText = "width:7px;height:7px;border-radius:50%;background:var(--color-primary,#0ea5e9);flex-shrink:0";
        row.appendChild(dot);
        var info = el("div", "ix-list-item__content gv-src-info");
        info.style.cssText = "flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;gap:2px !important;";
        info.appendChild(el("strong", "ix-list-item__title", s.itemTitle || "Sin título"));
        info.appendChild(el("small", "ix-list-item__description", s.sourceName || "Fuente"));
        row.appendChild(info);

        var actions = el("div", "gv-src-actions");
        actions.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto;";

        if (s.itemLink) {
          actions.appendChild(btnEl("Descargar ↗", "", function () { openExternal(s.itemLink); }));
          actions.appendChild(iconBtn("⧉", "Copiar enlace", function () {
            copyText(s.itemLink).then(function (ok) {
              toast(ok ? "Enlace copiado" : "No se pudo copiar", ok ? "success" : "error");
            });
          }));
        } else {
          actions.appendChild(el("span", "ix-badge ix-badge--mono gv-tag", "sin enlace"));
        }

        actions.appendChild(iconBtn("✕", "Quitar fuente", function () {
          g.sources = g.sources.filter(function (x) { return x !== s; });
          saveGames();
          rerender();
        }));
        row.appendChild(actions);
        secBody.appendChild(row);
      });
    }
    detail.appendChild(sec);
  }

  // ---------- picker de fuentes ----------

  function pickKey(ix, item) {
    return ix.id + "|" + (item.link || ("t:" + normStr(item.title)));
  }

  function ensureSourceLoaded(ix) {
    var c = sourceCache[ix.id];
    if (c && c.items) return Promise.resolve();
    if (state.pickLoading[ix.id]) return Promise.resolve();
    state.pickLoading[ix.id] = true;
    return loadSourceItems(ix).then(function () {
      delete state.pickLoading[ix.id];
      var e = sourceCache[ix.id];
      state.pickErrors[ix.id] = e && e.error ? e.error : null;
    });
  }

  function PickerToolbarComponent(props) {
    var h = React.createElement;
    var _useState = React.useState(props.query || ""),
      query = _useState[0],
      setQuery = _useState[1];

    React.useEffect(function () {
      setQuery(props.query || "");
    }, [props.query]);

    function onQueryChange(e) {
      var val = (e && e.target) ? e.target.value : (typeof e === "string" ? e : "");
      setQuery(val);
      props.onQuery(val);
    }

    function onClear() {
      setQuery("");
      props.onQuery("");
    }

    var SearchInputComp = (uiKit && uiKit.SearchInput) || null;
    var ButtonComp = (uiKit && uiKit.Button) || "button";

    return h(
      "div",
      {
        className: "gv-toolbar",
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          width: "100%",
          boxSizing: "border-box",
        },
      },
      // 1. Selector de juego destino del catálogo (para cambiar de juego sin salir)
      props.games && props.games.length > 1
        ? h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 } },
            h("span", { style: { fontSize: "11.5px", color: "var(--color-text-secondary, #94a3b8)", whiteSpace: "nowrap" } }, "Juego:"),
            h(
              "select",
              {
                className: "ix-select gv-select",
                value: props.currentGameId,
                onChange: function (e) { props.onGameChange(e.target.value); },
                "aria-label": "Seleccionar juego destino",
                style: { minWidth: "160px", maxWidth: "240px", flexShrink: 0 },
              },
              props.games.map(function (gm) {
                return h("option", { key: gm.id, value: gm.id }, gm.name);
              })
            )
          )
        : null,
      // 2. Buscador React SearchInput para filtrar elementos en las fuentes
      SearchInputComp
        ? h(
            "div",
            { style: { flex: "1 1 240px", minWidth: "200px" } },
            h(SearchInputComp, {
              value: query,
              onChange: onQueryChange,
              onClear: onClear,
              placeholder: "Filtrar por título en tus fuentes…",
              className: "gv-picker-search-input",
            })
          )
        : null,
      // 3. Botón Añadir visibles
      h(
        ButtonComp,
        {
          variant: "secondary",
          size: "sm",
          onClick: props.onAddVisible,
          style: { flexShrink: 0, marginLeft: "auto" },
        },
        rLabel("＋ Añadir visibles")
      )
    );
  }

  function renderPicker(page) {
    var g = currentGame();
    if (!g) {
      var allG = gamesCache || [];
      if (allG.length) {
        state.gameId = allG[0].id;
        g = allG[0];
      } else {
        toast("No hay juegos en tu vault", "info");
        go("library");
        return;
      }
    }
    var indexes = getSources();

    var ownLinks = {};
    (g.sources || []).forEach(function (s) { if (s.itemLink) ownLinks[s.itemLink] = true; });

    headerBar(page, {
      icon: "🔗",
      title: "Añadir fuentes a los juegos",
      subtitle: g.name,
      actions: [
        { label: "← Volver", onClick: function () { go("detail"); } },
        { label: "Listo", primary: true, onClick: function () { commitPicks(g, ownLinks); } },
      ],
    });

    if (!indexes.length) {
      emptyState(page, "No tienes índices cargados", "Importa fuentes en IndexLy y vuelve aquí.");
      return;
    }

    var chips = el("div", "controls filter-chips gv-head");
    var chipSpans = {};
    function addChip(id, label, count, loading) {
      var c = el("button", "chip gv-chip" + (state.pickIndexId === id ? " active" : ""));
      c.type = "button";
      c.appendChild(document.createTextNode(label));
      if (count != null) {
        var n = el("span", "gv-chip-n ix-tab__count", loading ? "…" : fmtNum(count));
        if (id != null) chipSpans[id] = n;
        c.appendChild(n);
      }
      c.addEventListener("click", function () {
        state.pickIndexId = id;
        state.pickLimit = PICK_RENDER_LIMIT;
        rerender();
      });
      chips.appendChild(c);
    }
    addChip(null, "Todas las fuentes", null, false);
    indexes.forEach(function (ix) {
      addChip(ix.id, ix.name, sourceCount(ix), !!state.pickLoading[ix.id]);
    });
    page.appendChild(chips);

    var rows = el("div", "gv-results");
    var statusLine = el("div", "gv-head");
    var statusText = el("small", "", "");
    statusLine.appendChild(statusText);

    var foot = el("div", "gv-footbar");
    var footText = el("small", "ix-badge ix-badge--mono", "");
    foot.appendChild(footText);
    foot.appendChild(el("span", "gv-spacer"));
    foot.appendChild(btnEl("Listo", "gv-btn-primary", function () { commitPicks(g, ownLinks); }));

    var allGames = gamesCache || [];

    function handleAddVisible() {
      var n = 0;
      rows.querySelectorAll("[data-pick-key]").forEach(function (row) {
        var key = row.getAttribute("data-pick-key");
        if (!key || row.getAttribute("data-disabled") === "1" || state.picks[key]) return;
        state.picks[key] = JSON.parse(row.getAttribute("data-pick-src"));
        n++;
      });
      fill();
      toast(n ? n + " elementos seleccionados" : "No hay elementos nuevos visibles", n ? "success" : "info");
    }

    var toolbarHost = el("div", "gv-toolbar-host");
    page.appendChild(toolbarHost);

    var debounce = null;

    if (React && uiKit && typeof mount === "function" && uiKit.SearchInput) {
      mount(
        React.createElement(PickerToolbarComponent, {
          query: state.pickQuery,
          currentGameId: g.id,
          games: allGames,
          onQuery: function (val) {
            state.pickQuery = val;
            state.pickLimit = PICK_RENDER_LIMIT;
            fill();
          },
          onGameChange: function (newGameId) {
            state.gameId = newGameId;
            var targetG = currentGame();
            if (targetG) {
              state.pickQuery = cleanTitle(targetG.name).name || targetG.name;
            }
            rerender();
          },
          onAddVisible: handleAddVisible,
        }),
        toolbarHost
      );
    } else {
      var toolbar = el("div", "gv-toolbar");
      toolbar.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;gap:10px !important;flex-wrap:wrap !important;";
      if (allGames.length > 1) {
        var gameSel = document.createElement("select");
        gameSel.className = "ix-select gv-select";
        gameSel.setAttribute("aria-label", "Seleccionar juego destino");
        allGames.forEach(function (gm) {
          var opt = document.createElement("option");
          opt.value = gm.id;
          opt.textContent = gm.name;
          if (gm.id === g.id) opt.selected = true;
          gameSel.appendChild(opt);
        });
        gameSel.addEventListener("change", function () {
          state.gameId = gameSel.value;
          var targetG = currentGame();
          if (targetG) {
            state.pickQuery = cleanTitle(targetG.name).name || targetG.name;
          }
          rerender();
        });
        toolbar.appendChild(gameSel);
      }
      var input = el("input", "gv-input");
      input.type = "search";
      input.value = state.pickQuery;
      toolbar.appendChild(searchWrapEl(input, "Filtrar por título en tus fuentes…", function () {
        state.pickQuery = "";
        state.pickLimit = PICK_RENDER_LIMIT;
        fill();
      }));
      var addVisible = btnEl("＋ Añadir visibles", "", handleAddVisible);
      addVisible.style.marginLeft = "auto";
      toolbar.appendChild(addVisible);
      toolbarHost.appendChild(toolbar);

      input.addEventListener("input", function () {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(function () {
          state.pickQuery = input.value;
          state.pickLimit = PICK_RENDER_LIMIT;
          fill();
        }, 220);
      });
    }

    page.appendChild(statusLine);
    page.appendChild(rows);
    page.appendChild(foot);
    foot.appendChild(btnEl("Listo", "gv-btn-primary", function () { commitPicks(g, ownLinks); }));
    page.appendChild(foot);

    var debounce = null;

    function sourceList() {
      return state.pickIndexId == null ? indexes : indexes.filter(function (ix) { return ix.id === state.pickIndexId; });
    }

    function fill() {
      if (!rows.isConnected) return;
      rows.innerHTML = "";
      var q = normStr(state.pickQuery);
      var collected = [];
      var totalMatches = 0;
      var pending = 0;

      indexes.forEach(function (ix) {
        if (state.pickIndexId != null && ix.id !== state.pickIndexId) return;
        if (state.pickLoading[ix.id]) pending++;
        if (chipSpans[ix.id]) chipSpans[ix.id].textContent = state.pickLoading[ix.id] ? "…" : fmtNum(sourceCount(ix));
        var c = sourceCache[ix.id];
        if (!c || !c.items) return;
        c.items.forEach(function (item) {
          if (q && normStr(item.title).indexOf(q) < 0) return;
          totalMatches++;
          if (collected.length < state.pickLimit) collected.push({ ix: ix, item: item });
        });
      });

      collected.forEach(function (entry) {
        var ix = entry.ix;
        var item = entry.item;
        var key = pickKey(ix, item);
        var own = item.link && ownLinks[item.link];
        var elsewhere = item.link && vaultIndex.byLink[item.link] && vaultIndex.byLink[item.link] !== g;
        var selected = !!state.picks[key];

        var row = el("div", "ix-card ix-card--interactive gv-res-row");
        row.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;gap:14px !important;padding:12px 18px !important;border-radius:var(--radius-xl,14px) !important;min-height:58px !important;box-sizing:border-box !important;";
        row.setAttribute("data-pick-key", key);
        row.setAttribute("data-pick-src", JSON.stringify({
          indexId: ix.id, sourceName: ix.name, itemTitle: item.title, itemLink: item.link || "",
        }));
        if (own || elsewhere) row.setAttribute("data-disabled", "1");

        var badge = el("span", "ix-badge ix-badge--mono gv-tag", (ix.name || "Fuente").slice(0, 18));
        badge.style.cssText = "flex-shrink:0 !important;font-size:11px !important;padding:4px 8px !important;";
        row.appendChild(badge);

        var info = el("div", "gv-res-info");
        info.style.cssText = "flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;gap:3px !important;";
        info.appendChild(el("strong", "", item.title));
        var sub = item.sourceName + (item.subtitle ? " · " + item.subtitle : "");
        if (own) sub = "Ya enlazada a este juego";
        else if (elsewhere) sub = "Ya está en «" + elsewhere.name + "»";
        info.appendChild(el("small", "", sub));
        row.appendChild(info);

        var b = btnEl(own ? "✓ Añadida" : (elsewhere ? "En otro juego" : (selected ? "✓ Seleccionada" : "＋")), selected ? "gv-btn-primary" : "");
        b.style.cssText = "flex-shrink:0 !important;margin-left:auto !important;white-space:nowrap !important;";
        if (own || elsewhere) b.disabled = true;
        else b.addEventListener("click", function () {
          if (state.picks[key]) delete state.picks[key];
          else state.picks[key] = JSON.parse(row.getAttribute("data-pick-src"));
          fill();
        });
        row.appendChild(b);
        rows.appendChild(row);
      });

      if (!rows.children.length) {
        if (pending) {
          skeletonRows(rows, 4);
        } else if (q) {
          emptyState(rows, "Nada coincide", "Prueba con otra búsqueda.");
        } else {
          var errs = Object.keys(state.pickErrors).filter(function (k) { return state.pickErrors[k]; });
          if (errs.length) emptyState(rows, "No se pudieron leer las fuentes", state.pickErrors[errs[0]]);
          else emptyState(rows, "Estas fuentes no tienen elementos", "Comprueba que el índice tenga datos importados.");
        }
      } else if (totalMatches > collected.length) {
        var more = btnEl("Mostrar más (" + fmtNum(totalMatches - collected.length) + " restantes)", "", function () {
          state.pickLimit += PICK_RENDER_LIMIT;
          fill();
        });
        more.style.alignSelf = "center";
        more.style.margin = "8px auto 0";
        rows.appendChild(more);
      }

      var n = Object.keys(state.picks).length;
      footText.textContent = n ? n + (n === 1 ? " seleccionado" : " seleccionados") : "Selecciona elementos";
      statusText.textContent = pending
        ? "Cargando " + pending + (pending === 1 ? " fuente…" : " fuentes…")
        : (totalMatches ? fmtNum(totalMatches) + " elementos · mostrando " + fmtNum(collected.length) : "");
    }

    function loadVisible() {
      var targets = sourceList();
      var i = 0;
      function step() {
        if (i >= targets.length) { fill(); return; }
        var ix = targets[i++];
        ensureSourceLoaded(ix).then(function () { fill(); step(); });
      }
      fill();
      step();
    }

    fill();
    loadVisible();
  }

  function commitPicks(game, ownLinks) {
    var added = 0;
    Object.keys(state.picks).forEach(function (k) {
      var s = state.picks[k];
      if (!s) return;
      if (s.itemLink && ownLinks[s.itemLink]) return;
      if (s.itemLink && vaultIndex.byLink[s.itemLink] && vaultIndex.byLink[s.itemLink] !== game) return;
      if (mergeSource(game, s)) {
        if (s.itemLink) ownLinks[s.itemLink] = true;
        added++;
      }
    });
    saveGames();
    toast(added === 0 ? "No hay fuentes nuevas" : (added === 1 ? "1 fuente añadida" : added + " fuentes añadidas"), added ? "success" : "info");
    state.picks = {};
    go("detail");
  }

  // ---------- auto-match ----------

  function cleanTitle(raw) {
    var t = String(raw || "").trim();
    var year = null;
    var ym = t.match(/\b(19\d{2}|20\d{2})\b/);
    if (ym) year = ym[1];
    t = t
      .replace(/\((?:19|20)\d{2}\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\bv\.?\s?\d+(?:\.\d+)*\b/gi, " ")
      .replace(/\b(?:repack|fitgirl|dodi|elamigos|gog|steam|online|offline|multi\d*|crack(?:ed)?|codex|plaza|goldberg|update\s?\d+|dlc|portable|rip)\b/gi, " ")
      .replace(/[-–—_/|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length > 70) t = t.slice(0, 70).trim();
    return { name: t, year: year };
  }

  function amatchBuildItems(ix, items) {
    var am = state.am;
    var seen = {};
    var out = [];
    (items || []).forEach(function (item) {
      var clean = cleanTitle(item.title);
      if (!clean.name || clean.name.length < 2) return;
      var key = normStr(clean.name);
      if (seen[key]) return;
      if (am.onlyLinks && !item.link) return;
      if (!am.includeExisting) {
        if (item.link && vaultIndex.byLink[item.link]) return;
        if (vaultIndex.byName[key] && (!item.link || vaultIndex.byLink[item.link])) return;
      }
      seen[key] = true;
      out.push({
        key: key,
        title: item.title,
        clean: clean,
        link: item.link || "",
        indexId: ix.id,
        indexName: ix.name,
        status: "pending",
        result: null,
        alternatives: [],
        detail: null,
        keep: false,
        error: "",
        domId: "",
      });
    });
    if (am.limit && out.length > am.limit) out = out.slice(0, am.limit);
    out.forEach(function (it, i) { it.domId = "gv-am-row-" + i; });
    return out;
  }

  function searchForItem(it) {
    return gdbSearch(it.clean.name, 8).then(function (hits) {
      it.alternatives = hits;
      if (!hits.length) {
        it.status = "nomatch";
        it.keep = false;
        return null;
      }
      it.result = hits[0];
      if (vaultIndex.byGdb[String(hits[0].id)]) {
        it.status = "invault";
        it.keep = true;
        return null;
      }
      it.status = "found";
      it.keep = true;
      it.detail = { name: hits[0].name, gdbId: String(hits[0].id), genres: [] };
      return null;
    }).catch(function (err) {
      it.status = "error";
      it.keep = false;
      it.error = err && err.name === "AbortError" ? "timeout" : ((err && err.message) || "error de red");
    });
  }

  function amatchRun() {
    var am = state.am;
    if (!am || am.running) return;
    am.running = true;
    am.done = false;
    am.stopping = false;
    var queue = am.items.filter(function (it) { return it.status === "pending"; });
    am.total = queue.length;
    am.progress = 0;
    var active = 0;

    function finish() {
      am.running = false;
      am.done = true;
      rerender();
    }

    function next() {
      if (am.stopping) {
        if (active === 0) finish();
        return;
      }
      if (!queue.length) {
        if (active === 0) finish();
        return;
      }
      var it = queue.shift();
      active++;
      it.status = "searching";
      amatchUpdateRow(it);
      searchForItem(it).then(function () {
        active--;
        am.progress++;
        amatchUpdateRow(it);
        amatchUpdateProgress();
        next();
      });
    }

    for (var i = 0; i < Math.min(AM_CONCURRENCY, queue.length); i++) next();
    if (!queue.length) finish();
  }

  function amatchRetryOne(it) {
    it.status = "searching";
    it.error = "";
    amatchUpdateRow(it);
    searchForItem(it).then(function () {
      amatchUpdateRow(it);
      amatchUpdateProgress();
    });
  }

  function amatchUpdateProgress() {
    var am = state.am;
    if (!am) return;
    var lbl = document.getElementById("gv-am-progress");
    var bar = document.getElementById("gv-am-bar");
    var pct = am.total ? Math.round((am.progress / am.total) * 100) : 0;
    if (lbl) {
      lbl.textContent = am.total
        ? am.progress + " / " + am.total + (am.stopping ? " · deteniendo…" : "")
        : "";
    }
    if (bar) bar.style.width = pct + "%";
    var confirmBtn = document.getElementById("gv-am-confirm");
    if (confirmBtn) {
      var n = am.items.filter(function (it) { return it.keep && it.result; }).length;
      confirmBtn.textContent = n ? "Añadir " + n + (n === 1 ? " juego" : " juegos") : "Añadir seleccionados";
    }
  }

  function amatchUpdateRow(it) {
    var row = document.getElementById(it.domId);
    if (!row) return;

    var badge = row.querySelector('[data-role="badge"]');
    if (badge) {
      var label = "en cola";
      var color = "#64748b";
      var badgeCls = "ix-badge gv-badge";
      if (it.status === "found") { label = "nuevo"; color = "#4ade80"; badgeCls += " ix-badge--success"; }
      else if (it.status === "invault") { label = "fusionar"; color = "#38bdf8"; badgeCls += " ix-badge--primary"; }
      else if (it.status === "nomatch") { label = "sin match"; color = "#64748b"; }
      else if (it.status === "error") { label = "error"; color = "#f87171"; badgeCls += " ix-badge--danger"; }
      else if (it.status === "searching") { label = "buscando…"; color = "#fbbf24"; badgeCls += " ix-badge--warning"; }
      badge.className = badgeCls;
      badge.textContent = label;
      badge.style.color = "";
      badge.style.borderColor = "";
    }

    var strong = row.querySelector('[data-role="name"]');
    if (strong) strong.textContent = it.result ? it.result.name : it.clean.name;

    var thumb = row.querySelector('[data-role="thumb"]');
    if (thumb && it.detail && (it.detail.coverUrl || it.detail.imageUrl) && !thumb.querySelector("img")) {
      thumb.innerHTML = "";
      var img = document.createElement("img");
      img.src = it.detail.coverUrl || it.detail.imageUrl;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
    }

    var sub = row.querySelector('[data-role="sub"]');
    if (sub) {
      var bits = ["original: " + it.title];
      if (it.detail) {
        if (it.detail.released) bits.push(fmtDate(it.detail.released));
        if (it.detail.rating != null) bits.push("★ " + it.detail.rating);
        if (it.detail.developer) bits.push(it.detail.developer);
      }
      if (it.link) bits.push("con enlace");
      if (it.error) bits.push("error: " + it.error);
      sub.textContent = bits.join(" · ");
    }

    var pick = row.querySelector('[data-role="pick"]');
    if (pick) {
      var hasResult = !!(it.result && (it.status === "found" || it.status === "invault"));
      pick.style.display = hasResult ? "" : "none";
      pick.className = "gv-check" + (it.keep ? " on" : "");
      setLabel(pick, it.keep ? "✓" : "");
    }

    var alt = row.querySelector('[data-role="alt"]');
    if (alt) alt.style.display = it.alternatives && it.alternatives.length > 1 ? "" : "none";

    var retry = row.querySelector('[data-role="retry"]');
    if (retry) retry.style.display = (it.status === "error" || it.status === "nomatch") ? "" : "none";
  }

  function amatchRow(it) {
    var row = el("div", "ix-card ix-card--interactive gv-row");
    row.id = it.domId;
    row.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;gap:14px !important;padding:12px 16px !important;border-radius:var(--radius-xl,14px) !important;min-height:64px !important;box-sizing:border-box !important;width:100% !important;";

    var thumb = el("div", "gv-row-thumb");
    thumb.setAttribute("data-role", "thumb");
    thumb.style.cssText = "width:48px !important;height:64px !important;border-radius:8px !important;overflow:hidden !important;flex-shrink:0 !important;background:var(--color-bg,#070a12);display:grid !important;place-items:center !important;font-size:16px !important;font-weight:700 !important;color:#fff !important;box-shadow:0 2px 8px rgba(0,0,0,0.3) !important;";
    thumb.style.background = gradientFor(it.title);
    thumb.textContent = (it.clean.name || "?").charAt(0).toUpperCase();
    row.appendChild(thumb);

    var main = el("div", "gv-row-main");
    main.style.cssText = "flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;gap:3px !important;";
    var strong = el("strong", "");
    strong.setAttribute("data-role", "name");
    strong.style.cssText = "font-size:13.5px !important;color:var(--color-text,#f1f5f9) !important;font-weight:600 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important;";
    strong.textContent = it.clean.name;
    main.appendChild(strong);
    var sub = el("small", "gv-row-sub");
    sub.setAttribute("data-role", "sub");
    sub.style.cssText = "font-size:11.5px !important;color:var(--color-text-tertiary,#64748b) !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;display:block !important;";
    sub.textContent = "original: " + it.title;
    main.appendChild(sub);
    row.appendChild(main);

    var badge = el("span", "ix-badge gv-badge", "en cola");
    badge.setAttribute("data-role", "badge");
    badge.style.cssText = "flex-shrink:0 !important;";
    row.appendChild(badge);

    var alt = iconBtn("⇄", "Elegir otra coincidencia", function () { openAlternatives(it); });
    alt.setAttribute("data-role", "alt");
    alt.style.cssText = "flex-shrink:0 !important;display:none;";
    row.appendChild(alt);

    var retry = iconBtn("↻", "Reintentar", function () { amatchRetryOne(it); });
    retry.setAttribute("data-role", "retry");
    retry.style.cssText = "flex-shrink:0 !important;display:none;";
    row.appendChild(retry);

    var pick = el("button", "gv-check", "");
    pick.type = "button";
    pick.setAttribute("data-role", "pick");
    pick.title = "Incluir / excluir";
    pick.style.cssText = "flex-shrink:0 !important;display:none;";
    pick.addEventListener("click", function () {
      it.keep = !it.keep;
      amatchUpdateRow(it);
      amatchUpdateProgress();
    });
    row.appendChild(pick);

    amatchUpdateRow(it);
    return row;
  }

  function openAlternatives(it) {
    api.modal({
      title: "Elegir coincidencia — " + it.clean.name,
      html: function (body) {
        var list = el("div", "gv-results");
        (it.alternatives || []).forEach(function (h) {
          var row = el("div", "ix-card ix-card--interactive gv-res-row");
          var info = el("div", "gv-res-info");
          info.appendChild(el("strong", "", h.name));
          info.appendChild(el("small", "", "IGDB #" + h.id + " · relevancia " + (4 - Math.min(3, h.rank))));
          row.appendChild(info);
          var isCurrent = it.result && String(it.result.id) === String(h.id);
          row.appendChild(btnEl(isCurrent ? "✓ Actual" : "Elegir", isCurrent ? "gv-btn-primary" : "", function () {
            it.result = { id: h.id, name: h.name };
            it.status = "found";
            it.keep = true;
            it.detail = null;
            it.error = "";
            if (typeof window.closePluginModal === "function") window.closePluginModal();
            amatchUpdateRow(it);
            amatchUpdateProgress();
            gdbGame(h.id).then(function (j) {
              if (j && it.result && String(it.result.id) === String(h.id)) {
                it.detail = mapGameDB(j);
                amatchUpdateRow(it);
              }
            }).catch(function () {});
          }));
          list.appendChild(row);
        });
        body.appendChild(list);
      },
      actions: [{ label: "Cerrar" }],
    });
  }

  function amatchConfirm() {
    var am = state.am;
    if (!am) return;
    var kept = am.items.filter(function (it) { return it.keep && it.result; });
    if (!kept.length) { toast("No hay juegos seleccionados", "info"); return; }

    var btn = document.getElementById("gv-am-confirm");
    if (btn) btn.disabled = true;
    var added = 0, merged = 0, skipped = 0, done = 0;

    var queue = kept.slice();
    var activeWorkers = 0;
    var CONFIRM_CONCURRENCY = 8;

    function finish() {
      saveGames();
      var parts = [];
      if (added) parts.push(added + (added === 1 ? " juego añadido" : " juegos añadidos"));
      if (merged) parts.push(merged + (merged === 1 ? " fuente fusionada" : " fuentes fusionadas"));
      if (skipped) parts.push(skipped + " sin cambios");
      toast(parts.join(" · ") || "Sin cambios", "success", 4500);
      state.am = null;
      go("library");
    }

    function work() {
      if (!queue.length) {
        if (activeWorkers === 0) finish();
        return;
      }
      var it = queue.shift();
      activeWorkers++;

      var detailPromise = (it.detail && (it.detail.coverUrl || it.detail.description))
        ? Promise.resolve(it.detail)
        : gdbGame(it.result.id).then(function (j) { return mapGameDB(j); }).catch(function () {
            return { name: it.result.name, gdbId: String(it.result.id), genres: [], platforms: [], screenshots: [] };
          });

      detailPromise.then(function (mapped) {
        var existing = null;
        if (mapped && mapped.gdbId != null) existing = vaultIndex.byGdb[String(mapped.gdbId)] || null;
        if (!existing && it.link) existing = vaultIndex.byLink[it.link] || null;

        var src = it.link ? {
          indexId: it.indexId,
          sourceName: it.indexName,
          itemTitle: it.title,
          itemLink: it.link,
        } : null;

        if (existing) {
          if (src && mergeSource(existing, src)) merged++;
          else skipped++;
        } else {
          addGdbGameMapped(mapped, src ? [src] : []);
          added++;
        }
      }).finally(function () {
        activeWorkers--;
        done++;
        if (btn) btn.textContent = "Añadiendo " + done + " / " + kept.length + "…";
        work();
      });
    }

    for (var w = 0; w < Math.min(CONFIRM_CONCURRENCY, kept.length); w++) work();
  }

  function renderAMatch(page) {
    var am = state.am;
    if (!am) { go("library"); return; }
    var indexes = getSources();

    headerBar(page, {
      icon: "⚡",
      title: "Auto-match",
      subtitle: "Detecta juegos en una fuente y enlázalos con su ficha de GameDB",
      actions: [{ label: "← Volver", onClick: function () { go("library"); } }],
    });

    var help = el("div", "ix-callout ix-callout--info gv-help");
    var hIcon = el("div", "ix-callout__icon");
    hIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    help.appendChild(hIcon);
    var hContent = el("div", "ix-callout__content");
    hContent.innerHTML = "Escanear lee los títulos de una fuente, limpia versiones/repacks y los busca en GameDB. " +
      "Puedes <strong>elegir otra coincidencia</strong>, reintentar fallos y confirmar solo lo que quieras. " +
      "Si el juego ya está en la vault, su fuente se fusiona en la ficha existente.";
    help.appendChild(hContent);
    page.appendChild(help);

    var panel = el("div", "ix-card gv-toolbar gv-am-toolbar");
    panel.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;gap:12px !important;flex-wrap:wrap !important;width:100% !important;box-sizing:border-box !important;padding:14px 18px !important;";

    var sel = document.createElement("select");
    sel.className = "ix-select gv-select";
    sel.setAttribute("aria-label", "Fuente a escanear");
    sel.style.cssText = "min-width:200px !important;flex:1 1 200px !important;max-width:320px !important;";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Elige la fuente a escanear…";
    sel.appendChild(ph);
    indexes.forEach(function (ix) {
      var op = document.createElement("option");
      op.value = ix.id;
      op.textContent = ix.name + " (" + fmtNum(sourceCount(ix)) + ")";
      if (am.indexId === ix.id) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", function () { am.indexId = sel.value || null; });
    panel.appendChild(sel);

    var limitSel = document.createElement("select");
    limitSel.className = "ix-select gv-select";
    limitSel.setAttribute("aria-label", "Límite de candidatos");
    limitSel.style.cssText = "min-width:110px !important;flex:0 0 auto !important;";
    [[50, "50 juegos"], [100, "100 juegos"], [250, "250 juegos"], [0, "Todos"]].forEach(function (o) {
      var op = document.createElement("option");
      op.value = String(o[0]);
      op.textContent = o[1];
      if (Number(am.limit) === o[0]) op.selected = true;
      limitSel.appendChild(op);
    });
    limitSel.addEventListener("change", function () { am.limit = Number(limitSel.value); });
    panel.appendChild(limitSel);

    var onlyWrap = el("label", "ix-checkbox gv-chip");
    onlyWrap.style.cssText = "display:inline-flex !important;align-items:center !important;gap:8px !important;cursor:pointer !important;height:36px !important;padding:0 12px !important;border:1px solid var(--color-border,#1e293b) !important;border-radius:var(--radius-md,8px) !important;background:var(--color-surface,#10151f) !important;font-size:12px !important;color:var(--color-text-secondary,#94a3b8) !important;white-space:nowrap !important;user-select:none !important;flex:0 0 auto !important;";
    var onlyCb = document.createElement("input");
    onlyCb.type = "checkbox";
    onlyCb.checked = !!am.onlyLinks;
    onlyCb.addEventListener("change", function () { am.onlyLinks = onlyCb.checked; });
    onlyWrap.appendChild(onlyCb);
    onlyWrap.appendChild(document.createTextNode("Solo con enlace"));
    panel.appendChild(onlyWrap);

    var existWrap = el("label", "ix-checkbox gv-chip");
    existWrap.style.cssText = "display:inline-flex !important;align-items:center !important;gap:8px !important;cursor:pointer !important;height:36px !important;padding:0 12px !important;border:1px solid var(--color-border,#1e293b) !important;border-radius:var(--radius-md,8px) !important;background:var(--color-surface,#10151f) !important;font-size:12px !important;color:var(--color-text-secondary,#94a3b8) !important;white-space:nowrap !important;user-select:none !important;flex:0 0 auto !important;";
    var existCb = document.createElement("input");
    existCb.type = "checkbox";
    existCb.checked = !!am.includeExisting;
    existCb.addEventListener("change", function () { am.includeExisting = existCb.checked; });
    existWrap.appendChild(existCb);
    existWrap.appendChild(document.createTextNode("Incluir ya guardados"));
    panel.appendChild(existWrap);

    var scan = btnEl(am.running ? "Escaneando…" : "⚡ Escanear", "gv-btn-primary", function () {
      var ix = indexes.find(function (i) { return i.id === am.indexId; });
      if (!ix) { toast("Elige una fuente primero", "warning"); return; }
      scan.disabled = true;
      scan.textContent = "Cargando fuente…";
      loadSourceItems(ix).then(function (items) {
        am.items = amatchBuildItems(ix, items);
        if (!am.items.length) {
          toast("Nada nuevo que escanear en esa fuente", "info");
          rerender();
          return;
        }
        am.progress = 0;
        am.total = am.items.length;
        am.done = false;
        am.stopping = false;
        am.running = false;
        amatchRun();
        rerender();
      });
    });
    scan.style.cssText = "margin-left:auto !important;flex-shrink:0 !important;";
    if (am.running) scan.disabled = true;
    panel.appendChild(scan);

    if (am.running) {
      var stopBtn = btnEl("Detener", "gv-btn-danger", function (e) {
        am.stopping = true;
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = "Deteniendo…";
        amatchUpdateProgress();
      });
      stopBtn.style.cssText = "flex-shrink:0 !important;";
      panel.appendChild(stopBtn);
    }
    page.appendChild(panel);

    var progressRow = el("div", "gv-head");
    var track = el("div", "gv-progress");
    var bar = el("span");
    bar.id = "gv-am-bar";
    bar.style.width = (am.total ? Math.round((am.progress / am.total) * 100) : 0) + "%";
    track.appendChild(bar);
    progressRow.appendChild(track);
    var prog = el("small", "", "");
    prog.id = "gv-am-progress";
    progressRow.appendChild(prog);
    page.appendChild(progressRow);

    if (!am.items.length) {
      emptyState(page, "Sin candidatos todavía", "Elige una fuente y pulsa Escanear. Se omiten los títulos ya guardados salvo que marques «Incluir ya guardados».");
      return;
    }

    var bulk = el("div", "gv-head");
    bulk.style.cssText = "display:flex !important;flex-direction:row !important;align-items:center !important;gap:10px !important;flex-wrap:wrap !important;width:100% !important;box-sizing:border-box !important;";
    bulk.appendChild(btnEl("Seleccionar todo", "", function () {
      am.items.forEach(function (it) { if (it.result) it.keep = true; });
      rerender();
    }));
    bulk.appendChild(btnEl("Ninguno", "", function () {
      am.items.forEach(function (it) { it.keep = false; });
      rerender();
    }));
    bulk.appendChild(btnEl("Solo nuevos", "", function () {
      am.items.forEach(function (it) { it.keep = it.status === "found"; });
      rerender();
    }));

    var filterBox = el("div", "gv-am-filter");
    filterBox.style.cssText = "flex:1 1 200px !important;min-width:180px !important;max-width:320px !important;";
    var filterInput = el("input", "gv-input");
    filterInput.type = "search";
    filterInput.value = am.filter || "";
    filterBox.appendChild(searchWrapEl(filterInput, "Filtrar candidatos…", function () {
      am.filter = "";
      renderCandidateList();
    }));
    filterInput.addEventListener("input", function () {
      am.filter = filterInput.value;
      renderCandidateList();
    });
    bulk.appendChild(filterBox);

    var confirmBtn = btnEl("Añadir seleccionados", "gv-btn-primary", amatchConfirm);
    confirmBtn.id = "gv-am-confirm";
    confirmBtn.style.cssText = "margin-left:auto !important;flex-shrink:0 !important;";
    if (am.running) confirmBtn.disabled = true;
    bulk.appendChild(confirmBtn);
    page.appendChild(bulk);

    var list = el("div", "gv-results");
    page.appendChild(list);

    function renderCandidateList() {
      list.innerHTML = "";
      var q = normStr(am.filter || "");
      var filtered = am.items.filter(function (it) {
        if (!q) return true;
        var t = normStr(it.title || "");
        var c = normStr((it.clean && it.clean.name) || "");
        var r = normStr((it.result && it.result.name) || "");
        return t.indexOf(q) >= 0 || c.indexOf(q) >= 0 || r.indexOf(q) >= 0;
      });

      if (!filtered.length) {
        emptyState(list, "Ningún candidato coincide", "Prueba a cambiar el filtro de búsqueda.");
        return;
      }

      var RENDER_CHUNK = 120;
      var renderedCount = Math.min(RENDER_CHUNK, filtered.length);
      for (var idx = 0; idx < renderedCount; idx++) {
        list.appendChild(amatchRow(filtered[idx]));
      }

      if (filtered.length > renderedCount) {
        var moreRow = el("div", "", "");
        moreRow.style.textAlign = "center";
        moreRow.style.padding = "16px";
        var moreBtn = btnEl("Mostrar más candidatos (" + (filtered.length - renderedCount) + " restantes)", "", function () {
          var nextLimit = Math.min(renderedCount + RENDER_CHUNK, filtered.length);
          for (var k = renderedCount; k < nextLimit; k++) {
            list.insertBefore(amatchRow(filtered[k]), moreRow);
          }
          renderedCount = nextLimit;
          if (renderedCount >= filtered.length) {
            moreRow.remove();
          } else {
            moreBtn.textContent = "Mostrar más candidatos (" + (filtered.length - renderedCount) + " restantes)";
          }
        });
        moreRow.appendChild(moreBtn);
        list.appendChild(moreRow);
      }
    }

    renderCandidateList();

    amatchUpdateProgress();
  }

  // ---------- ajustes ----------

  function normalizeImported(x) {
    return {
      id: String(x.id || ("m" + Date.now() + Math.random().toString(36).slice(2, 6))),
      name: String(x.name || "Sin título").slice(0, 120),
      imageUrl: x.imageUrl || "",
      coverUrl: x.coverUrl || "",
      rating: x.rating != null ? x.rating : null,
      metacritic: x.metacritic != null ? x.metacritic : null,
      released: x.released || "",
      genres: Array.isArray(x.genres) ? x.genres.slice(0, 8) : [],
      platforms: Array.isArray(x.platforms) ? x.platforms.slice(0, 12) : [],
      developer: x.developer || "",
      pegi: x.pegi || null,
      website: x.website || "",
      description: x.description || "",
      screenshots: Array.isArray(x.screenshots) ? x.screenshots.slice(0, 6) : [],
      gdbId: x.gdbId != null ? String(x.gdbId) : (x.rawgId != null ? String(x.rawgId) : null),
      gdbUrl: x.gdbUrl || x.rawgUrl || "",
      status: STATUSES.some(function (s) { return s.id === x.status; }) ? x.status : "backlog",
      addedAt: x.addedAt || Date.now(),
      sources: Array.isArray(x.sources) ? x.sources.filter(function (s) { return s && typeof s === "object"; }) : [],
    };
  }

  function updateAllMetadata(btn) {
    var targets = (gamesCache || []).filter(function (g) { return g.gdbId && (!g.description || !g.coverUrl); });
    if (!targets.length) { toast("No hay fichas incompletas", "info"); return; }
    if (btn) btn.disabled = true;
    var i = 0, ok = 0, fail = 0;
    function step() {
      if (i >= targets.length) {
        saveGames();
        toast(ok + " fichas actualizadas" + (fail ? " · " + fail + " fallos" : ""), ok ? "success" : "warning", 4500);
        rerender();
        return;
      }
      var g = targets[i++];
      if (btn) btn.textContent = "Actualizando " + i + " / " + targets.length + "…";
      gdbGame(g.gdbId).then(function (j) {
        if (j) { mergeMappedInto(g, mapGameDB(j), false); ok++; } else { fail++; }
      }).catch(function () { fail++; }).then(step);
    }
    step();
  }

  function renderSettings(page) {
    headerBar(page, {
      icon: "⚙",
      title: "Ajustes de GameVault",
      subtitle: "Datos, estadísticas y copias de seguridad",
      actions: [{ label: "← Volver", onClick: function () { go("library"); } }],
    });

    // Fuente de datos
    var srcSec = el("div", "ix-card gv-section");
    var srcT = el("div", "ix-card__header gv-section-title");
    srcT.appendChild(el("h5", "ix-card__title", "Fuente de datos"));
    srcT.appendChild(el("span", "gv-spacer"));
    var conn = el("span", "ix-badge ix-badge--primary ix-badge--mono", "GameDB · IGDB");
    srcT.appendChild(conn);
    srcSec.appendChild(srcT);
    var srcBody = el("div", "ix-card__body", "");
    srcBody.style.cssText = "display:flex;flex-direction:column;gap:12px;padding:16px 20px";
    var srcInfo = el("div", "ix-callout ix-callout--info gv-help");
    var sIcon = el("div", "ix-callout__icon");
    sIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    srcInfo.appendChild(sIcon);
    var sText = el("div", "ix-callout__content");
    sText.innerHTML = "<strong style=\"color:#4ade80\">✓ Sin configuración</strong> — GameVault usa " +
      "<a href=\"https://github.com/LizardByte/GameDB\" target=\"_blank\" rel=\"noopener\">GameDB</a>, " +
      "una copia pública de la base de datos de IGDB publicada por LizardByte como JSON estático " +
      "(374.000+ juegos, actualizada a diario). No hay claves, ni cuotas, ni cuentas. " +
      "Solo se consultan <code>app.lizardbyte.dev</code> e <code>images.igdb.com</code>.";
    srcInfo.appendChild(sText);
    srcBody.appendChild(srcInfo);
    var testRow = el("div", "gv-head");
    var testBtn = btnEl("Probar conexión", "", function () {
      testBtn.disabled = true;
      testBtn.textContent = "Comprobando…";
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      gdbJson("buckets/el.json").then(function () {
        var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
        var ms = Math.round(t1 - t0);
        testBtn.textContent = "Probar conexión";
        testBtn.disabled = false;
        var n = el("div", "gv-notice ok ix-callout ix-callout--success", "✓ GameDB responde en " + ms + " ms");
        n.style.flex = "1";
        testRow.innerHTML = "";
        testRow.appendChild(testBtn);
        testRow.appendChild(n);
      }).catch(function (err) {
        testBtn.textContent = "Probar conexión";
        testBtn.disabled = false;
        var n = el("div", "gv-notice err ix-callout ix-callout--danger", "✕ " + ((err && err.message) || "sin conexión"));
        n.style.flex = "1";
        testRow.innerHTML = "";
        testRow.appendChild(testBtn);
        testRow.appendChild(n);
      });
    });
    testRow.appendChild(testBtn);
    srcBody.appendChild(testRow);
    srcSec.appendChild(srcBody);
    page.appendChild(srcSec);

    // Estadísticas
    var games = gamesCache || [];
    var stSec = el("div", "ix-card gv-section");
    var stT = el("div", "ix-card__header gv-section-title");
    stT.appendChild(el("h5", "ix-card__title", "Estadísticas"));
    stT.appendChild(el("span", "gv-spacer"));
    stT.appendChild(el("span", "ix-badge ix-badge--mono", games.length + (games.length === 1 ? " juego" : " juegos")));
    stSec.appendChild(stT);
    var stCardBody = el("div", "ix-card__body", "");
    stCardBody.style.cssText = "display:flex;flex-direction:column;gap:12px;padding:16px 20px";

    function statRow(label, count, max, color) {
      var row = el("div", "gv-head");
      row.style.marginBottom = "4px";
      var l = el("small", "", label);
      l.style.cssText = "width:150px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--color-text-secondary)";
      row.appendChild(l);
      var track = el("span", "gv-progress");
      track.style.cssText = "flex:1;height:8px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;display:block";
      var bar = el("span");
      bar.style.cssText = "display:block;height:100%;width:" + (max ? Math.round((count / max) * 100) : 0) + "%;border-radius:999px;background:" + color;
      track.appendChild(bar);
      row.appendChild(track);
      var cText = el("small", "ix-badge ix-badge--mono", String(count));
      row.appendChild(cText);
      return row;
    }

    var stBox = el("div");
    stBox.style.cssText = "display:flex;flex-direction:column;gap:6px;background:var(--color-bg,#070a12);border:1px solid var(--color-border,#1e293b);border-radius:var(--radius-lg,12px);padding:14px 16px";
    stCardBody.appendChild(stBox);

    if (!games.length) {
      stBox.appendChild(el("small", "", "Añade juegos para ver estadísticas."));
    } else {
      var withSrc = games.filter(function (g) { return (g.sources || []).length > 0; }).length;
      stBox.appendChild(statRow("Total", games.length, games.length, "var(--color-primary, #0ea5e9)"));
      stBox.appendChild(statRow("Con fuente", withSrc, games.length, "#22c55e"));
      STATUSES.forEach(function (st) {
        var n = games.filter(function (g) { return g.status === st.id; }).length;
        if (n) stBox.appendChild(statRow(st.label, n, games.length, st.color));
      });
      var gCount = {};
      games.forEach(function (g) { (g.genres || []).forEach(function (gn) { gCount[gn] = (gCount[gn] || 0) + 1; }); });
      var gTop = Object.keys(gCount).sort(function (a, b) { return gCount[b] - gCount[a]; }).slice(0, 5);
      gTop.forEach(function (gn) { stBox.appendChild(statRow(gn, gCount[gn], gCount[gTop[0]], "#38bdf8")); });
      var yCount = {};
      games.forEach(function (g) {
        if (g.released) {
          var y = String(g.released).slice(0, 4);
          if (/^\d{4}$/.test(y)) yCount[y] = (yCount[y] || 0) + 1;
        }
      });
      var yTop = Object.keys(yCount).sort(function (a, b) { return yCount[b] - yCount[a]; }).slice(0, 5);
      yTop.forEach(function (y) { stBox.appendChild(statRow(y, yCount[y], yCount[yTop[0]], "#fbbf24")); });
    }
    stSec.appendChild(stCardBody);
    page.appendChild(stSec);

    // Backup
    var bk = el("div", "ix-card gv-section");
    var bt = el("div", "ix-card__header gv-section-title");
    bt.appendChild(el("h5", "ix-card__title", "Backup de la vault"));
    bk.appendChild(bt);
    var bkBody = el("div", "ix-card__body", "");
    bkBody.style.cssText = "padding:16px 20px";
    var brow = el("div", "gv-head");

    brow.appendChild(btnEl("Exportar JSON", "", function () {
      var data = JSON.stringify({ app: "indexly-gamevault", version: 2, exportedAt: new Date().toISOString(), games: gamesCache || [] }, null, 2);
      var blob = new Blob([data], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "gamevault-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("Vault exportada", "success");
    }));

    brow.appendChild(btnEl("Importar JSON", "", function () {
      var fi = document.createElement("input");
      fi.type = "file";
      fi.accept = ".json,application/json";
      fi.addEventListener("change", function () {
        var file = fi.files && fi.files[0];
        if (!file) return;
        file.text().then(function (txt) {
          var parsed = JSON.parse(txt);
          var list = Array.isArray(parsed) ? parsed : parsed.games;
          if (!Array.isArray(list)) throw new Error("El archivo no contiene una vault (games[])");
          list = list.filter(function (x) { return x && typeof x.name === "string"; });
          if (!list.length) throw new Error("El archivo no contiene juegos válidos");
          api.modal({
            title: "Importar vault",
            html: "<p>Se reemplazará tu vault actual (" + (gamesCache || []).length + " juegos) por la del archivo (" + list.length + " juegos). ¿Continuar?</p>",
            actions: [
              { label: "Cancelar" },
              { label: "Reemplazar", danger: true, onClick: function () {
                gamesCache = list.map(normalizeImported);
                saveGames();
                toast("Vault importada: " + gamesCache.length + " juegos", "success");
                go("library");
              } },
            ],
          });
        }).catch(function (err) {
          toast("Import falló: " + err.message, "error", 5000);
        });
      });
      fi.click();
    }));

    brow.appendChild(btnEl("Actualizar metadatos", "", function (e) { updateAllMetadata(e.currentTarget); }, "Completa fichas incompletas desde GameDB"));
    brow.appendChild(btnEl("Vaciar vault", "gv-btn-danger", function () {
      api.modal({
        title: "Vaciar GameVault",
        html: "<p>Se eliminarán <strong>" + (gamesCache || []).length + " juegos</strong> de tu vault. Tus índices de IndexLy no se tocan. Esta acción no se puede deshacer.</p>",
        actions: [
          { label: "Cancelar" },
          { label: "Vaciar", danger: true, onClick: function () {
            gamesCache = [];
            saveGames();
            toast("Vault vaciada", "info");
            go("library");
          } },
        ],
      });
    }));
    bkBody.appendChild(brow);
    bk.appendChild(bkBody);
    page.appendChild(bk);

    // Guía rápida
    var helpSec = el("div", "ix-card gv-section");
    var ht = el("div", "ix-card__header gv-section-title");
    ht.appendChild(el("h5", "ix-card__title", "Guía rápida"));
    helpSec.appendChild(ht);
    var hSecBody = el("div", "ix-card__body", "");
    hSecBody.style.cssText = "padding:16px 20px";
    var guide = el("div", "ix-callout ix-callout--info gv-help");
    guide.innerHTML =
      "<strong>Buscar juegos</strong>: escribe un título y pulsa «＋ Añadir». Se guarda con carátula, descripción, rating y fecha.<br>" +
      "<strong>Fuentes</strong>: dentro de un juego, «＋ Fuente» busca en tus índices. Puedes seleccionar varios elementos y pulsar «Listo».<br>" +
      "<strong>＋ Vault</strong>: en los resultados de IndexLy, guarda el elemento como juego. Si ya existe, fusiona la fuente.<br>" +
      "<strong>Auto-match</strong>: escanea una fuente entera, revisa coincidencias y confirma.<br>" +
      "<strong>Privacidad</strong>: la colección vive en el almacenamiento local de IndexLy. Solo se consultan GameDB e images.igdb.com.";
    hSecBody.appendChild(guide);
    helpSec.appendChild(hSecBody);
    page.appendChild(helpSec);
  }

  // ---------- badge en las tarjetas de IndexLy ----------

  function decorateCard(e) {
    if (!e || !e.el || !e.game) return;
    var link = e.game.link;
    if (!link) return;
    var g = vaultIndex.byLink[link];
    if (!g) return;
    if (e.el.querySelector(".gv-badge-vault")) return;
    var info = e.el.querySelector(".game-info-container") || e.el.querySelector(".grid-body");
    if (!info) return;
    var b = el("span", "gv-badge-vault", "✓ en vault");
    b.title = "En GameVault: " + g.name;
    info.appendChild(b);
  }

  // Hook de test: solo se expone cuando el harness lo activa antes de cargar el plugin.
  if (typeof window !== "undefined" && window.__INDEXLY_PLUGIN_TEST__) {
    window.__gvTest = {
      cleanTitle: cleanTitle,
      gdbSearch: gdbSearch,
      mapGameDB: mapGameDB,
      normalizeSourceItem: normalizeSourceItem,
      sourceCount: sourceCount,
      loadSourceItems: loadSourceItems,
      invalidateSourceCache: invalidateSourceCache,
      amatchBuildItems: amatchBuildItems,
      mergeSource: mergeSource,
      rebuildVaultIndex: rebuildVaultIndex,
      openPicker: openPicker,
      getVault: function () { return gamesCache; },
      setVault: function (list) { gamesCache = list || []; rebuildVaultIndex(); },
      setApi: function (a) { api = a; },
      state: state,
    };
  }

  // ---------- registro ----------

  IndexLy.register({
    setup: function (ctx) {
      api = ctx;
      resolveHostUi(ctx);
      ensureStyles();
      ensureGames(function () {});

      ctx.addSection({ id: "gamevault", label: "GameVault", render: renderPage });

      if (typeof ctx.addDocSection === "function") {
        ctx.addDocSection({
          id: "gamevault",
          title: "GameVault — tu colección de juegos",
          html:
            "<p><strong>GameVault</strong> añade una pestaña donde guardar tu colección de juegos" +
            " con carátulas, ficha completa y <strong>fuentes de descarga</strong> enlazadas a tus" +
            " propios índices de IndexLy. No necesita ninguna configuración.</p>" +
            "<ul>" +
            "<li><strong>Buscar juegos</strong>: usa <code>GameDB</code> (copia pública de IGDB).</li>" +
            "<li><strong>Estados</strong>: Backlog, Jugando, Terminado o Abandonado.</li>" +
            "<li><strong>Fuentes de descarga</strong>: elige elementos de tus índices y ábrelos con «Descargar».</li>" +
            "<li><strong>＋ Vault</strong>: guarda un resultado de búsqueda como juego.</li>" +
            "<li><strong>Auto-match</strong>: escanea una fuente y confirma las coincidencias.</li>" +
            "<li><strong>Backup</strong>: exporta/importa la vault como JSON.</li>" +
            "</ul>" +
            "<p><strong>Privacidad</strong>: la colección vive en tu almacenamiento local. Solo se consultan" +
            " <code>app.lizardbyte.dev</code> e <code>images.igdb.com</code>.</p>",
        });
      }

      ctx.addCardAction({
        id: "gv-add",
        label: "＋ Vault",
        match: function (g) { return !!(g && g.title); },
        onClick: quickAdd,
      });

      ctx.on("items:hydrate", decorateCard);

      ["sources:changed", "source:added", "source:updated", "source:removed", "items:changed"].forEach(function (ev) {
        try {
          ctx.on(ev, function () { invalidateSourceCache(); });
        } catch (err) { /* eventos no soportados en hosts antiguos */ }
      });
    },
  });
})();
