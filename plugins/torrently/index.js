/* IndexLy Plugin — Co-Kernel V3
   id: torrently
   name: TorrentLy
   version: 2.0.0
   description: Gestor de torrents real. Detecta qBittorrent automáticamente y, si no está disponible, abre los magnets en tu cliente por defecto. Sin configuración obligatoria. Una sola fuente «🧲 Torrents» en el buscador.
   permissions: network, ui, storage, settings, os:windows, data:write
   capabilities: ui:slots, ui:section, ui:modal, storage, settings
*/
(function (IndexLy) {
  "use strict";

  // ==========================================================================
  // 0. CONSTANTES
  // ==========================================================================

  var STORAGE_KEY = "torrently_state_v4";
  var LEGACY_KEY = "torrently_state_v3";
  var PASS_KEY = "torrently.qb.password";
  var SOURCE_NAME = "🧲 Torrents";
  var POLL_ACTIVE_MS = 1000;
  var POLL_IDLE_MS = 4000;
  var POLL_HIDDEN_MS = 5000;
  var PROBE_TTL_MS = 30000;
  var MAX_TORRENT_BYTES = 32 * 1024 * 1024;

  var DEFAULT_SETTINGS = {
    mode: "auto", // auto | qbittorrent | external
    qbUrl: "http://127.0.0.1:8080",
    qbUsername: "",
    savePath: "",
    addPaused: false,
    showInSearch: true,
  };

  var STATE_LABELS = {
    downloading: "Descargando",
    stalledDL: "Sin peers",
    metaDL: "Obteniendo metadatos",
    forcedDL: "Descargando (forzado)",
    queuedDL: "En cola",
    checkingDL: "Comprobando",
    allocating: "Reservando espacio",
    uploading: "Sembrando",
    stalledUP: "Sembrando (sin peers)",
    forcedUP: "Sembrando (forzado)",
    queuedUP: "En cola (subida)",
    checkingUP: "Comprobando",
    pausedDL: "Pausado",
    pausedUP: "Completado",
    stoppedDL: "Detenido",
    stoppedUP: "Completado",
    error: "Error",
    missingFiles: "Faltan archivos",
    moving: "Moviendo",
    unknown: "Desconocido",
  };

  var ACTIVE_STATES = {
    downloading: 1, metaDL: 1, forcedDL: 1, stalledDL: 1, queuedDL: 1,
    checkingDL: 1, allocating: 1, moving: 1,
  };

  // ==========================================================================
  // 1. ESTADO
  // ==========================================================================

  var api = null;
  var activeRoot = null;
  var disposers = [];
  var pollTimer = null;
  var rid = 0;
  var live = {};
  var serverState = {};
  var cachedPassword = null;
  var lastPaint = 0;
  var booting = false;
  var engine = {
    status: "idle", // idle | probing | connected | auth | offline | external
    kind: "external",
    version: null,
    webapiVersion: null,
    error: null,
    lastProbe: 0,
    client: null,
  };

  var state = {
    loaded: false,
    migrated: false,
    torrents: [],
    sourceId: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    ui: {
      view: "list",
      filter: "all",
      hash: null,
      detailTab: "general",
      files: {},     // hash -> { loading, error, list }
      fileSel: {},   // hash -> { index: bool }
    },
  };

  // ==========================================================================
  // 2. UTILIDADES
  // ==========================================================================

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
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

  function toast(msg, type, ms) {
    if (api && typeof api.showToast === "function") api.showToast(msg, type || "success", ms);
    else console.log("[TorrentLy]", msg);
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    if (api && typeof api.copyToClipboard === "function") return Promise.resolve(api.copyToClipboard(text));
    if (navigator.clipboard) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }

  function refreshHost() {
    if (api && typeof api.refreshApp === "function") {
      try { api.refreshApp(); } catch (e) { /* host antiguo */ }
    }
  }

  function fmtBytes(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return "—";
    var units = ["B", "KB", "MB", "GB", "TB", "PB"];
    var i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    var dec = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
    return v.toFixed(dec).replace(".", ",") + " " + units[i];
  }

  function fmtSpeed(bps) {
    var v = Number(bps);
    if (!isFinite(v) || v <= 0) return "—";
    return fmtBytes(v) + "/s";
  }

  function fmtEta(sec) {
    var s = Number(sec);
    if (!isFinite(s) || s < 0 || s >= 8640000) return "∞";
    if (s < 60) return Math.round(s) + " s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " h " + (m % 60) + " min";
    return Math.floor(h / 24) + " d " + (h % 24) + " h";
  }

  function fmtPercent(p) {
    var v = Number(p);
    if (!isFinite(v)) return "0 %";
    if (v >= 1) return "100 %";
    return (v * 100).toFixed(v > 0.1 ? 1 : 2).replace(".", ",") + " %";
  }

  function fmtDate(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function simpleHash(str) {
    var h = 5381;
    var s = String(str || "");
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  function uniq(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (x) {
      var k = String(x);
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push(x);
    });
    return out;
  }

  function hex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
    return out;
  }

  // ==========================================================================
  // 3. SHA-1 / SHA-256 (WebCrypto con fallback JS para SHA-1)
  // ==========================================================================

  function subtleAvailable() {
    return typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function";
  }

  function sha1Js(bytes) {
    var ml = bytes.length * 8;
    var withOne = bytes.length + 1;
    var total = withOne + ((56 - (withOne % 64)) + 64) % 64 + 8;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    var hi = Math.floor(ml / 4294967296);
    var lo = ml >>> 0;
    buf[total - 8] = (hi >>> 24) & 255;
    buf[total - 7] = (hi >>> 16) & 255;
    buf[total - 6] = (hi >>> 8) & 255;
    buf[total - 5] = hi & 255;
    buf[total - 4] = (lo >>> 24) & 255;
    buf[total - 3] = (lo >>> 16) & 255;
    buf[total - 2] = (lo >>> 8) & 255;
    buf[total - 1] = lo & 255;

    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    var w = new Int32Array(80);

    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) {
        var j = off + i * 4;
        w[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
      }
      for (var i2 = 16; i2 < 80; i2++) {
        var x = w[i2 - 3] ^ w[i2 - 8] ^ w[i2 - 14] ^ w[i2 - 16];
        w[i2] = (x << 1) | (x >>> 31);
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (var t = 0; t < 80; t++) {
        var f, k;
        if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }

    var out = new Uint8Array(20);
    [h0, h1, h2, h3, h4].forEach(function (h, idx) {
      out[idx * 4] = (h >>> 24) & 255;
      out[idx * 4 + 1] = (h >>> 16) & 255;
      out[idx * 4 + 2] = (h >>> 8) & 255;
      out[idx * 4 + 3] = h & 255;
    });
    return hex(out);
  }

  async function sha1Hex(bytes) {
    if (subtleAvailable()) {
      try {
        var d = await crypto.subtle.digest("SHA-1", bytes);
        return hex(new Uint8Array(d));
      } catch (e) { /* cae al fallback */ }
    }
    return sha1Js(bytes);
  }

  async function sha256Hex(bytes) {
    if (!subtleAvailable()) return null;
    try {
      var d = await crypto.subtle.digest("SHA-256", bytes);
      return hex(new Uint8Array(d));
    } catch (e) {
      return null;
    }
  }

  // ==========================================================================
  // 4. BENCODE
  // ==========================================================================

  function latin1(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function decodeTorrentString(bytes) {
    if (!bytes.length) return "";
    // Los campos binarios grandes (p. ej. "pieces") no se necesitan: se evita
    // materializar megabytes de texto basura.
    if (bytes.length > 65536) {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (e) {
        return { __binary: true, length: bytes.length };
      }
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return latin1(bytes);
    }
  }

  /**
   * Decodifica bencode conservando los offsets de cada nodo. Los offsets son
   * imprescindibles para calcular el info_hash sobre los bytes exactos del
   * diccionario `info`.
   */
  function decodeBencode(input, opts) {
    var limit = (opts && opts.maxBytes) || MAX_TORRENT_BYTES;
    if (!(input instanceof Uint8Array)) input = new Uint8Array(input);
    if (input.length > limit) throw new Error("El torrent supera el límite de " + fmtBytes(limit));

    var pos = 0;
    var depthMax = (opts && opts.maxDepth) || 64;

    function fail(msg) {
      throw new Error("bencode: " + msg + " (byte " + pos + ")");
    }

    function parseValue(depth) {
      if (depth > depthMax) fail("profundidad excesiva");
      if (pos >= input.length) fail("fin inesperado");
      var start = pos;
      var c = input[pos];

      if (c === 0x69) { // i
        pos++;
        var s0 = pos;
        while (pos < input.length && input[pos] !== 0x65) pos++;
        if (pos >= input.length) fail("entero sin cerrar");
        var raw = latin1(input.subarray(s0, pos));
        pos++;
        if (!/^-?\d+$/.test(raw)) fail("entero inválido");
        return { value: parseInt(raw, 10), start: start, end: pos };
      }

      if (c === 0x6c) { // l
        pos++;
        var arr = [];
        var items = [];
        while (pos < input.length && input[pos] !== 0x65) {
          var child = parseValue(depth + 1);
          arr.push(child.value);
          items.push(child);
        }
        if (pos >= input.length) fail("lista sin cerrar");
        pos++;
        return { value: arr, start: start, end: pos, items: items };
      }

      if (c === 0x64) { // d
        pos++;
        var obj = {};
        var entries = {};
        while (pos < input.length && input[pos] !== 0x65) {
          var keyNode = parseValue(depth + 1);
          if (typeof keyNode.value !== "string") fail("clave no textual");
          var valNode = parseValue(depth + 1);
          obj[keyNode.value] = valNode.value;
          entries[keyNode.value] = valNode;
        }
        if (pos >= input.length) fail("diccionario sin cerrar");
        pos++;
        return { value: obj, start: start, end: pos, entries: entries };
      }

      if (c >= 0x30 && c <= 0x39) {
        var lenStart = pos;
        while (pos < input.length && input[pos] !== 0x3a) pos++;
        if (pos >= input.length) fail("longitud sin ':'");
        var len = parseInt(latin1(input.subarray(lenStart, pos)), 10);
        if (!isFinite(len) || len < 0) fail("longitud inválida");
        pos++;
        if (pos + len > input.length) fail("cadena truncada");
        var slice = input.subarray(pos, pos + len);
        pos += len;
        return { value: decodeTorrentString(slice), start: start, end: pos };
      }

      fail("token desconocido 0x" + c.toString(16));
    }

    var root = parseValue(0);
    return { value: root.value, node: root, end: pos };
  }

  // ==========================================================================
  // 5. MAGNETS
  // ==========================================================================

  function base32ToHex(str) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    var up = String(str || "").toUpperCase().replace(/=+$/, "");
    var bits = 0;
    var value = 0;
    var out = "";
    for (var i = 0; i < up.length; i++) {
      var idx = alphabet.indexOf(up.charAt(i));
      if (idx < 0) return null;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        out += ("0" + ((value >>> bits) & 255).toString(16)).slice(-2);
      }
    }
    return out.length === 40 ? out : null;
  }

  function normalizeBtih(value) {
    var v = String(value || "").trim();
    if (/^[a-f0-9]{40}$/i.test(v)) return v.toLowerCase();
    if (/^[a-z2-7]{32}$/i.test(v)) return base32ToHex(v);
    return null;
  }

  function parseMagnet(uri) {
    if (typeof uri !== "string") return null;
    var raw = uri.trim();
    if (!/^magnet:\?/i.test(raw)) return null;

    var query = raw.slice(raw.indexOf("?") + 1);
    var params;
    try {
      params = new URLSearchParams(query);
    } catch (e) {
      return null;
    }

    var infoHash = null;
    var v2Hash = null;
    params.getAll("xt").forEach(function (xt) {
      var m1 = /^urn:btih:([a-z0-9]+)$/i.exec(xt);
      if (m1) {
        var h = normalizeBtih(m1[1]);
        if (h) infoHash = h;
      }
      var m2 = /^urn:btmh:1220([a-f0-9]{64})$/i.exec(xt);
      if (m2) v2Hash = m2[1].toLowerCase();
    });

    if (!infoHash && !v2Hash) return null;

    var size = parseInt(params.get("xl") || "", 10);
    return {
      infoHash: infoHash,
      v2Hash: v2Hash,
      name: params.get("dn") || "",
      trackers: uniq(params.getAll("tr")),
      size: isFinite(size) && size > 0 ? size : 0,
      raw: raw,
    };
  }

  function buildMagnet(p) {
    if (!p) return "";
    var parts = [];
    if (p.infoHash) parts.push("xt=urn:btih:" + p.infoHash.toLowerCase());
    if (p.v2Hash) parts.push("xt=urn:btmh:1220" + String(p.v2Hash).toLowerCase());
    if (!parts.length) return "";
    if (p.name) parts.push("dn=" + encodeURIComponent(p.name));
    (p.trackers || []).forEach(function (tr) {
      if (tr) parts.push("tr=" + encodeURIComponent(tr));
    });
    if (p.size && p.size > 0) parts.push("xl=" + Math.round(p.size));
    return "magnet:?" + parts.join("&");
  }

  function magnetKey(uri) {
    var p = parseMagnet(uri);
    if (p && p.infoHash) return p.infoHash;
    if (p && p.v2Hash) return "v2:" + p.v2Hash;
    return uri ? "u:" + simpleHash(uri) : "";
  }

  // ==========================================================================
  // 6. ARCHIVOS .TORRENT
  // ==========================================================================

  function collectTrackers(root) {
    var list = [];
    if (root && typeof root.announce === "string") list.push(root.announce);
    var tiers = root && root["announce-list"];
    if (Array.isArray(tiers)) {
      tiers.forEach(function (tier) {
        if (Array.isArray(tier)) {
          tier.forEach(function (tr) { if (typeof tr === "string") list.push(tr); });
        } else if (typeof tier === "string") {
          list.push(tier);
        }
      });
    }
    return uniq(list);
  }

  function walkFileTree(tree, prefix, out) {
    if (!tree || typeof tree !== "object") return;
    Object.keys(tree).forEach(function (key) {
      var node = tree[key];
      if (!node || typeof node !== "object") return;
      var leaf = node[""];
      if (leaf && typeof leaf === "object" && leaf.length != null) {
        out.push({ path: prefix + key, length: Number(leaf.length) || 0 });
      } else {
        walkFileTree(node, prefix + key + "/", out);
      }
    });
  }

  async function parseTorrentFile(bytes, fileName) {
    var decoded = decodeBencode(bytes);
    var root = decoded.value;
    if (!root || typeof root !== "object" || !root.info || typeof root.info !== "object") {
      throw new Error("El archivo no es un .torrent válido");
    }

    var info = root.info;
    var name = typeof info.name === "string" && info.name ? info.name : (fileName || "Torrent");
    var files = [];

    if (Array.isArray(info.files)) {
      info.files.forEach(function (f) {
        if (!f || typeof f !== "object") return;
        var path = Array.isArray(f.path) ? f.path.filter(function (x) { return typeof x === "string"; }).join("/") : "";
        files.push({ path: path || "(sin nombre)", length: Number(f.length) || 0 });
      });
    } else if (info.length != null) {
      files.push({ path: name, length: Number(info.length) || 0 });
    } else if (info["file tree"]) {
      walkFileTree(info["file tree"], "", files);
    }

    var totalSize = files.reduce(function (acc, f) { return acc + (f.length || 0); }, 0);
    var trackers = collectTrackers(root);

    var infoNode = decoded.node && decoded.node.entries && decoded.node.entries.info;
    var infoBytes = infoNode ? bytes.subarray(infoNode.start, infoNode.end) : null;
    var v1 = info.pieces ? (infoBytes ? await sha1Hex(infoBytes) : null) : null;
    var v2 = info["meta version"] === 2 ? (infoBytes ? await sha256Hex(infoBytes) : null) : null;

    return {
      name: name,
      infoHash: v1,
      v2Hash: v2,
      files: files,
      fileCount: files.length,
      totalSize: totalSize,
      trackers: trackers,
      comment: typeof root.comment === "string" ? root.comment : "",
      createdBy: typeof root["created by"] === "string" ? root["created by"] : "",
      magnet: buildMagnet({
        infoHash: v1,
        v2Hash: v2,
        name: name,
        trackers: trackers,
        size: totalSize,
      }),
    };
  }

  // ==========================================================================
  // 7. HTTP NATIVO + CLIENTE qBITTORRENT
  // ==========================================================================

  function formEncode(obj) {
    return Object.keys(obj || {}).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k] == null ? "" : String(obj[k]));
    }).join("&");
  }

  function normalizeQbUrl(url) {
    var u = String(url || "").trim();
    if (!u) u = "http://127.0.0.1:8080";
    if (!/^https?:\/\//i.test(u)) u = "http://" + u;
    u = u.replace(/\/+$/, "");
    try {
      var parsed = new URL(u);
      if (!parsed.port && parsed.protocol === "http:") {
        u = parsed.protocol + "//" + parsed.hostname + ":8080";
      }
    } catch (e) { /* se deja tal cual */ }
    return u;
  }

  function extractSid(headers) {
    if (!headers) return null;
    var raw = "";
    Object.keys(headers).forEach(function (k) {
      if (k.toLowerCase() === "set-cookie") {
        var v = headers[k];
        raw += (raw ? "; " : "") + (Array.isArray(v) ? v.join("; ") : String(v || ""));
      }
    });
    if (!raw) return null;
    var m = /(?:^|[;, ]\s*)((?:QBT_)?SID(?:_\w+)?=[^;]+)/i.exec(raw);
    if (m) return m[1].trim();
    var first = /(?:^|[;, ]\s*)([^=;\s]+=[^;]+)/.exec(raw);
    return first ? first[1].trim() : null;
  }

  async function nativeHttp(options) {
    if (api && api.native && api.native.http && typeof api.native.http.request === "function") {
      return await api.native.http.request(options);
    }
    // Fallback para desarrollo web. En escritorio siempre existe el comando
    // nativo; en el navegador qBittorrent bloqueará por CORS y se usará el
    // cliente externo.
    var res = await fetch(options.url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
    });
    var text = await res.text();
    var headers = {};
    res.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
    return { status: res.status, headers: headers, body: text };
  }

  /**
   * Cliente mínimo de la Web API de qBittorrent (v2). Mantiene la cookie SID en
   * el propio plugin; Rust solo hace de proxy HTTP.
   */
  function createQbClient(config) {
    var baseUrl = normalizeQbUrl(config && config.baseUrl);
    var http = (config && config.http) || nativeHttp;
    var username = (config && config.username) || "";
    var password = (config && config.password) || "";
    var sid = null;
    var authed = false;
    var version = null;
    var webapiVersion = null;

    function authError(msg, code) {
      var e = new Error(msg);
      e.code = code || "AUTH_FAILED";
      return e;
    }

    async function probe() {
      var r = await http({
        method: "GET",
        url: baseUrl + "/api/v2/app/version",
        timeoutMs: 1500,
      });
      if (r.status === 403 || r.status === 401) return { available: true, authRequired: true, version: null };
      if (r.status !== 200) throw new Error("qBittorrent respondió HTTP " + r.status);
      version = String(r.body || "").trim();
      try {
        var w = await http({ method: "GET", url: baseUrl + "/api/v2/app/webapiVersion", timeoutMs: 1500 });
        if (w.status === 200) webapiVersion = String(w.body || "").trim();
      } catch (e) { /* opcional */ }
      return { available: true, authRequired: false, version: version, webapiVersion: webapiVersion };
    }

    async function login(force) {
      if (authed && !force) return true;
      sid = null;

      if (!username && !password) {
        // Puede tener activado "Bypass authentication for clients on localhost".
        var r0 = await http({ method: "GET", url: baseUrl + "/api/v2/app/version", timeoutMs: 1500 });
        if (r0.status === 200) {
          version = String(r0.body || "").trim();
          authed = true;
          return true;
        }
        if (r0.status === 403 || r0.status === 401) throw authError("qBittorrent requiere usuario y contraseña", "AUTH_REQUIRED");
        throw new Error("qBittorrent respondió HTTP " + r0.status);
      }

      var r = await http({
        method: "POST",
        url: baseUrl + "/api/v2/auth/login",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: formEncode({ username: username, password: password }),
        timeoutMs: 5000,
      });

      if (r.status === 403 || r.status === 401) throw authError("qBittorrent rechazó las credenciales", "AUTH_FAILED");
      // En qBittorrent 5.x devuelve 204 No Content y en 4.x devuelve 200 OK
      if (r.status !== 200 && r.status !== 204) throw new Error("Login HTTP " + r.status);
      var bodyText = String(r.body || "").trim();
      if (bodyText === "Fails.") throw authError("Usuario o contraseña incorrectos", "AUTH_FAILED");

      var extracted = extractSid(r.headers);
      if (extracted) sid = extracted;
      authed = true;
      return true;
    }

    async function request(path, opts) {
      opts = opts || {};
      var retried = false;
      while (true) {
        if (!authed) await login();
        var headers = Object.assign({}, opts.headers || {});
        if (sid) headers.Cookie = sid;
        if (opts.form) headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";

        var r = await http({
          method: opts.method || "GET",
          url: baseUrl + path,
          headers: headers,
          body: opts.form ? formEncode(opts.form) : opts.body,
          timeoutMs: opts.timeoutMs || 8000,
        });

        if (r.status === 403 && !retried) {
          retried = true;
          await login(true);
          continue;
        }
        return r;
      }
    }

    async function json(path, opts) {
      var r = await request(path, opts);
      if (r.status !== 200) throw new Error("HTTP " + r.status + " en " + path);
      try {
        return JSON.parse(r.body || "{}");
      } catch (e) {
        throw new Error("Respuesta no JSON en " + path);
      }
    }

    async function sync(currentRid) {
      return await json("/api/v2/sync/maindata?rid=" + (currentRid || 0));
    }

    async function add(magnet, options) {
      var f = { urls: magnet };
      if (options && options.savePath) f.savepath = options.savePath;
      f.paused = options && options.paused ? "true" : "false";
      var r = await request("/api/v2/torrents/add", { method: "POST", form: f, timeoutMs: 20000 });
      if (r.status !== 200) throw new Error("qBittorrent rechazó el torrent (HTTP " + r.status + ")");
      if (/^fails/i.test(String(r.body || "").trim())) throw new Error("qBittorrent rechazó el torrent");
      return true;
    }

    async function setPaused(hash, paused) {
      var paths = paused
        ? ["/api/v2/torrents/stop", "/api/v2/torrents/pause"]
        : ["/api/v2/torrents/start", "/api/v2/torrents/resume"];
      var last = null;
      for (var i = 0; i < paths.length; i++) {
        var r = await request(paths[i], { method: "POST", form: { hashes: hash } });
        if (r.status === 200) return true;
        last = r;
        if (r.status !== 404 && r.status !== 405) break;
      }
      throw new Error("No se pudo cambiar el estado (HTTP " + (last ? last.status : "?") + ")");
    }

    async function remove(hash, deleteFiles) {
      var r = await request("/api/v2/torrents/delete", {
        method: "POST",
        form: { hashes: hash, deleteFiles: deleteFiles ? "true" : "false" },
      });
      if (r.status !== 200) throw new Error("No se pudo eliminar (HTTP " + r.status + ")");
      return true;
    }

    async function files(hash) {
      return await json("/api/v2/torrents/files?hash=" + encodeURIComponent(hash));
    }

    async function setFilePriority(hash, ids, priority) {
      var r = await request("/api/v2/torrents/setFilePrio", {
        method: "POST",
        form: { hash: hash, id: (ids || []).join("|"), priority: priority },
      });
      if (r.status !== 200) throw new Error("No se pudo cambiar la prioridad (HTTP " + r.status + ")");
      return true;
    }

    async function trackers(hash) {
      return await json("/api/v2/torrents/trackers?hash=" + encodeURIComponent(hash));
    }

    async function properties(hash) {
      return await json("/api/v2/torrents/properties?hash=" + encodeURIComponent(hash));
    }

    async function transferInfo() {
      return await json("/api/v2/transfer/info");
    }

    return {
      baseUrl: baseUrl,
      probe: probe,
      login: login,
      request: request,
      sync: sync,
      add: add,
      setPaused: setPaused,
      remove: remove,
      files: files,
      setFilePriority: setFilePriority,
      trackers: trackers,
      properties: properties,
      transferInfo: transferInfo,
      getVersion: function () { return version; },
      getWebapiVersion: function () { return webapiVersion; },
      isAuthed: function () { return authed; },
    };
  }

  function isQbConnected() {
    return engine.status === "connected" && !!engine.client;
  }

  function engineLabel() {
    if (state.settings.mode === "external") return "Cliente externo · modo manual";
    if (engine.status === "connected") return "qBittorrent " + (engine.version || "") + " · conectado";
    if (engine.status === "auth") return "qBittorrent detectado · requiere sesión";
    if (engine.status === "offline") return "qBittorrent no disponible · cliente externo";
    if (engine.status === "probing") return "Detectando qBittorrent…";
    return "Cliente externo";
  }

  async function readPassword() {
    if (cachedPassword != null) return cachedPassword;
    var value = null;
    try {
      if (api && api.native && api.native.keychain && typeof api.native.keychain.get === "function") {
        value = await api.native.keychain.get(PASS_KEY);
      } else {
        value = await api.storage.get(PASS_KEY);
      }
    } catch (e) { /* sin llavero */ }
    cachedPassword = value || "";
    return cachedPassword;
  }

  async function writePassword(value) {
    cachedPassword = value || "";
    try {
      if (api && api.native && api.native.keychain && typeof api.native.keychain.set === "function") {
        await api.native.keychain.set(PASS_KEY, cachedPassword);
      } else {
        await api.storage.set(PASS_KEY, cachedPassword);
      }
      return true;
    } catch (e) {
      toast("No se pudo guardar la contraseña: " + e.message, "error", 5000);
      return false;
    }
  }

  async function clearPassword() {
    cachedPassword = "";
    try {
      if (api && api.native && api.native.keychain && typeof api.native.keychain.delete === "function") {
        await api.native.keychain.delete(PASS_KEY);
      } else {
        await api.storage.remove(PASS_KEY);
      }
    } catch (e) { /* nada */ }
  }

  async function resolveEngine(force) {
    if (!force && engine.status === "connected" && Date.now() - engine.lastProbe < PROBE_TTL_MS) {
      return engine;
    }

    if (state.settings.mode === "external") {
      engine = { status: "external", kind: "external", version: null, webapiVersion: null, error: null, lastProbe: Date.now(), client: null };
      return engine;
    }

    engine = Object.assign({}, engine, { status: "probing", error: null });
    var password = await readPassword();
    var client = createQbClient({
      baseUrl: state.settings.qbUrl,
      username: state.settings.qbUsername,
      password: password,
      http: nativeHttp,
    });

    try {
      var info = await client.probe();
      if (info.authRequired || state.settings.qbUsername || password) {
        try {
          await client.login();
        } catch (authErr) {
          if (authErr.code === "AUTH_REQUIRED" || authErr.code === "AUTH_FAILED") {
            engine = {
              status: "auth", kind: "external", version: info.version || null,
              webapiVersion: null, error: authErr.message, lastProbe: Date.now(), client: null,
            };
            return engine;
          }
          throw authErr;
        }
      }

      engine = {
        status: "connected",
        kind: "qbittorrent",
        version: client.getVersion() || info.version || null,
        webapiVersion: client.getWebapiVersion() || info.webapiVersion || null,
        error: null,
        lastProbe: Date.now(),
        client: client,
      };
      rid = 0;
      live = {};
    } catch (err) {
      engine = {
        status: "offline",
        kind: "external",
        version: null,
        webapiVersion: null,
        error: err.message || String(err),
        lastProbe: Date.now(),
        client: null,
      };
    }

    return engine;
  }

  // ==========================================================================
  // 8. ESTADO PERSISTENTE Y MIGRACIÓN
  // ==========================================================================

  function normalizeEntry(t) {
    if (!t || typeof t !== "object") return null;
    var magnet = typeof t.magnet === "string" ? t.magnet : "";
    var parsed = magnet ? parseMagnet(magnet) : null;
    var infoHash = (typeof t.infoHash === "string" && t.infoHash) || (parsed && parsed.infoHash) || "";
    var id = t.id || infoHash || (magnet ? magnetKey(magnet) : "");
    if (!id) return null;
    return {
      id: id,
      infoHash: infoHash,
      name: String(t.name || (parsed && parsed.name) || "Torrent"),
      magnet: magnet,
      totalSize: Number(t.totalSize) || (parsed && parsed.size) || 0,
      fileCount: Number(t.fileCount) || 0,
      trackers: Array.isArray(t.trackers) ? uniq(t.trackers).slice(0, 20) : (parsed ? parsed.trackers.slice(0, 20) : []),
      addedAt: Number(t.addedAt) || Date.now(),
      engine: t.engine === "qbittorrent" ? "qbittorrent" : "external",
      external: !!t.external,
      source: t.source || "manual",
    };
  }

  function serializeEntry(t) {
    return {
      id: t.id,
      infoHash: t.infoHash || "",
      name: t.name,
      magnet: t.magnet || "",
      totalSize: t.totalSize || 0,
      fileCount: t.fileCount || 0,
      trackers: (t.trackers || []).slice(0, 20),
      addedAt: t.addedAt || Date.now(),
      engine: t.engine || "external",
      external: !!t.external,
      source: t.source || "manual",
    };
  }

  function migrateV3(old) {
    var seen = {};
    var torrents = [];
    var list = Array.isArray(old && old.torrents) ? old.torrents : [];

    list.forEach(function (t) {
      if (!t || typeof t !== "object") return;
      var magnet = typeof t.magnet === "string" ? t.magnet : "";
      var parsed = magnet ? parseMagnet(magnet) : null;
      var infoHash = (parsed && parsed.infoHash) || (typeof t.infoHash === "string" ? t.infoHash : "");
      var id = infoHash || (magnet ? magnetKey(magnet) : "");
      if (!id || seen[id]) return;
      seen[id] = 1;

      torrents.push({
        id: id,
        infoHash: infoHash,
        name: String(t.name || (parsed && parsed.name) || "Torrent"),
        magnet: magnet,
        totalSize: Number(t.totalSize) || (parsed && parsed.size) || 0,
        fileCount: Array.isArray(t.files) ? t.files.length : 0,
        trackers: parsed ? parsed.trackers.slice(0, 20) : [],
        addedAt: Number(t.createdAt) || Date.now(),
        engine: "external",
        external: false,
        source: "migrated",
      });
    });

    var oldSettings = (old && old.settings) || {};
    return {
      torrents: torrents,
      settings: {
        mode: "auto",
        qbUrl: DEFAULT_SETTINGS.qbUrl,
        qbUsername: "",
        savePath: typeof oldSettings.download_dir === "string" && oldSettings.download_dir !== "Downloads/IndexLy" ? oldSettings.download_dir : "",
        addPaused: false,
        showInSearch: true,
      },
    };
  }

  async function loadState() {
    var raw = null;
    try { raw = await api.storage.get(STORAGE_KEY); } catch (e) { /* storage vacío */ }

    if (raw && raw.version === 4) {
      state.torrents = (Array.isArray(raw.torrents) ? raw.torrents : []).map(normalizeEntry).filter(Boolean);
      state.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
      state.sourceId = raw.sourceId || null;
      return;
    }

    var legacy = null;
    try { legacy = await api.storage.get(LEGACY_KEY); } catch (e) { /* nada */ }
    if (legacy && (legacy.torrents || legacy.settings)) {
      var migrated = migrateV3(legacy);
      state.torrents = migrated.torrents;
      state.settings = Object.assign({}, DEFAULT_SETTINGS, migrated.settings);
      state.migrated = true;
    }
  }

  async function saveState() {
    try {
      await api.storage.set(STORAGE_KEY, {
        version: 4,
        torrents: state.torrents.map(serializeEntry),
        settings: state.settings,
        sourceId: state.sourceId,
      });
    } catch (e) {
      console.warn("[TorrentLy] No se pudo guardar el estado:", e);
    }
  }

  // ==========================================================================
  // 9. BIBLIOTECA
  // ==========================================================================

  function findEntry(id) {
    if (!id) return null;
    for (var i = 0; i < state.torrents.length; i++) {
      if (state.torrents[i].id === id) return state.torrents[i];
    }
    return null;
  }

  function findEntryByHash(hash) {
    if (!hash) return null;
    for (var i = 0; i < state.torrents.length; i++) {
      if (state.torrents[i].infoHash === hash) return state.torrents[i];
    }
    return null;
  }

  function liveFor(entry) {
    if (!entry || !entry.infoHash) return null;
    var h = String(entry.infoHash).toLowerCase();
    return live[h] || live[entry.infoHash] || null;
  }

  function addToLibrary(rec) {
    var id = rec.id || rec.infoHash || (rec.magnet ? magnetKey(rec.magnet) : "");
    if (!id) return null;

    var existing = findEntry(id);
    if (existing) {
      if (!existing.magnet && rec.magnet) existing.magnet = rec.magnet;
      if (!existing.infoHash && rec.infoHash) existing.infoHash = rec.infoHash;
      if (!existing.totalSize && rec.totalSize) existing.totalSize = rec.totalSize;
      if (!existing.fileCount && rec.fileCount) existing.fileCount = rec.fileCount;
      return { entry: existing, duplicate: true };
    }

    var entry = {
      id: id,
      infoHash: rec.infoHash || "",
      name: rec.name || "Torrent",
      magnet: rec.magnet || "",
      totalSize: Number(rec.totalSize) || 0,
      fileCount: Number(rec.fileCount) || 0,
      trackers: uniq(rec.trackers || []).slice(0, 20),
      addedAt: Date.now(),
      engine: "external",
      external: false,
      source: rec.source || "manual",
    };
    state.torrents.unshift(entry);
    return { entry: entry, duplicate: false };
  }

  function removeFromLibrary(id) {
    state.torrents = state.torrents.filter(function (t) { return t.id !== id; });
    delete live[id];
    delete state.ui.files[id];
    delete state.ui.files[id + ":trackers"];
    delete state.ui.fileSel[id];
    if (state.ui.hash === id) {
      state.ui.view = "list";
      state.ui.hash = null;
    }
  }

  async function openExternal(entry) {
    if (!entry || !entry.magnet) return false;
    entry.external = true;
    try {
      await api.openLink(entry.magnet);
      return true;
    } catch (e) {
      toast("No se pudo abrir el cliente de torrents", "error", 5000);
      return false;
    }
  }

  async function engineAdd(entry) {
    if (!entry || !entry.magnet) return false;

    if (isQbConnected()) {
      try {
        await engine.client.add(entry.magnet, {
          savePath: state.settings.savePath || "",
          paused: !!state.settings.addPaused,
        });
        entry.engine = "qbittorrent";
        entry.external = false;
        entry.lastError = null;
        return true;
      } catch (err) {
        entry.lastError = err.message || String(err);
        entry.engine = "external";
        toast("qBittorrent no pudo añadirlo: " + entry.lastError + ". Se abre en tu cliente.", "warning", 6000);
        await openExternal(entry);
        return false;
      }
    }

    await openExternal(entry);
    return false;
  }

  async function addTorrentInput(input, opts) {
    opts = opts || {};
    var candidates = [];

    if (typeof input === "string") {
      var lines = input.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      lines.forEach(function (line) {
        if (/^magnet:\?/i.test(line)) {
          var parsed = parseMagnet(line);
          if (!parsed) {
            toast("Magnet inválido: " + line.slice(0, 48), "error", 5000);
            return;
          }
          candidates.push({
            infoHash: parsed.infoHash || "",
            name: parsed.name || opts.title || ("Torrent " + (parsed.infoHash || "").slice(0, 8)),
            magnet: buildMagnet(parsed),
            totalSize: parsed.size || 0,
            trackers: parsed.trackers,
            source: opts.source,
          });
        } else if (/^https?:\/\//i.test(line)) {
          candidates.push({
            name: opts.title || decodeURIComponent((line.split("/").pop() || line).split("?")[0]) || line,
            magnet: line,
            source: opts.source,
          });
        } else {
          toast("Entrada no reconocida: " + line.slice(0, 48), "error", 5000);
        }
      });
    } else if (input && input.bytes) {
      try {
        var meta = await parseTorrentFile(input.bytes, input.fileName);
        if (!meta.magnet) throw new Error("No se pudo calcular el info_hash");
        candidates.push({
          infoHash: meta.infoHash || "",
          name: opts.title || meta.name,
          magnet: meta.magnet,
          totalSize: meta.totalSize,
          fileCount: meta.fileCount,
          trackers: meta.trackers,
          source: opts.source || "file",
          files: meta.files,
        });
      } catch (err) {
        toast("No se pudo leer el .torrent: " + err.message, "error", 6000);
        return { added: 0, duplicates: 0 };
      }
    }

    var added = 0;
    var duplicates = 0;
    var viaQb = 0;

    for (var i = 0; i < candidates.length; i++) {
      var rec = candidates[i];
      var res = addToLibrary(rec);
      if (!res) continue;
      if (res.duplicate) {
        duplicates++;
        continue;
      }
      if (rec.files) {
        state.ui.files[res.entry.id] = {
          loading: false,
          error: null,
          list: rec.files.map(function (f, idx) {
            return { index: idx, name: f.path, size: f.length, progress: 0 };
          }),
        };
      }
      if (await engineAdd(res.entry)) viaQb++;
      added++;
    }

    await saveState();
    await syncSource();

    if (added) {
      var noun = added === 1 ? " torrent" : " torrents";
      if (viaQb === added) toast(added + noun + " añadido" + (added === 1 ? "" : "s") + " a qBittorrent", "success");
      else if (viaQb === 0) toast(added + noun + " abierto" + (added === 1 ? "" : "s") + " en tu cliente", "success");
      else toast(added + noun + " añadido" + (added === 1 ? "" : "s") + " (" + viaQb + " a qBittorrent)", "success");
    } else if (duplicates) {
      toast("Ya estaba en TorrentLy", "info");
    }

    if (added) {
      state.ui.view = "list";
      paintIfSafe();
      refreshHost();
    }

    return { added: added, duplicates: duplicates };
  }

  async function togglePause(entry) {
    if (!isQbConnected() || !entry.infoHash) {
      toast("Pausar solo está disponible con qBittorrent", "info", 4000);
      return;
    }
    var l = liveFor(entry);
    var paused = l && /^(paused|stopped)/.test(l.state || "");
    try {
      await engine.client.setPaused(entry.infoHash, !paused);
      toast(paused ? "Reanudado" : "Pausado", "info");
      pollOnce();
    } catch (err) {
      toast("No se pudo cambiar el estado: " + err.message, "error", 5000);
    }
  }

  function confirmRemove(entry) {
    var canDeleteFiles = isQbConnected() && entry.engine === "qbittorrent" && entry.infoHash;
    openModal({
      title: "Quitar torrent",
      html:
        '<p>¿Seguro que deseas quitar <strong>' + esc(entry.name) + '</strong> de TorrentLy?</p>' +
        (canDeleteFiles
          ? '<label class="trly-check" style="margin-top:6px;background:rgba(239,68,68,.08);padding:10px 12px;border-radius:8px;border:1px solid rgba(239,68,68,.20)"><input type="checkbox" id="trly-del-files"> <span style="color:#fca5a5;font-weight:500">Borrar también los archivos descargados del disco</span></label>'
          : '<p class="trly-hint">No se borrarán archivos de tu disco ni se cerrará tu cliente externo.</p>'),
      actions: [
        { label: "Cancelar" },
        {
          label: "Quitar torrent",
          danger: true,
          onClick: async function (body) {
            var delFiles = body.querySelector("#trly-del-files");
            var ok = await removeTorrent(entry, delFiles ? !!delFiles.checked : false);
            if (ok) toast("Torrent quitado", "info");
          },
        },
      ],
    });
  }

  async function addTorrentInput(input, opts) {
    opts = opts || {};
    var candidates = [];

    if (typeof input === "string") {
      var lines = input.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      lines.forEach(function (line) {
        if (/^magnet:\?/i.test(line)) {
          var parsed = parseMagnet(line);
          if (!parsed) {
            toast("Magnet inválido: " + line.slice(0, 48), "error", 5000);
            return;
          }
          candidates.push({
            infoHash: parsed.infoHash || "",
            name: parsed.name || opts.title || ("Torrent " + (parsed.infoHash || "").slice(0, 8)),
            magnet: buildMagnet(parsed),
            totalSize: parsed.size || 0,
            trackers: parsed.trackers,
            source: opts.source,
          });
        } else if (/^https?:\/\//i.test(line)) {
          candidates.push({
            name: opts.title || decodeURIComponent((line.split("/").pop() || line).split("?")[0]) || line,
            magnet: line,
            source: opts.source,
          });
        } else {
          toast("Entrada no reconocida: " + line.slice(0, 48), "error", 5000);
        }
      });
    } else if (input && input.bytes) {
      try {
        var meta = await parseTorrentFile(input.bytes, input.fileName);
        if (!meta.magnet) throw new Error("No se pudo calcular el info_hash");
        candidates.push({
          infoHash: meta.infoHash || "",
          name: opts.title || meta.name,
          magnet: meta.magnet,
          totalSize: meta.totalSize,
          fileCount: meta.fileCount,
          trackers: meta.trackers,
          source: opts.source || "file",
          files: meta.files,
        });
      } catch (err) {
        toast("No se pudo leer el .torrent: " + err.message, "error", 6000);
        return { added: 0, duplicates: 0 };
      }
    }

    var added = 0;
    var duplicates = 0;
    var viaQb = 0;

    for (var i = 0; i < candidates.length; i++) {
      var rec = candidates[i];
      var res = addToLibrary(rec);
      if (!res) continue;
      if (res.duplicate) {
        duplicates++;
        continue;
      }
      if (rec.files) {
        state.ui.files[res.entry.id] = {
          loading: false,
          error: null,
          list: rec.files.map(function (f, idx) {
            return { index: idx, name: f.path, size: f.length, progress: 0 };
          }),
        };
      }
      if (await engineAdd(res.entry)) viaQb++;
      added++;
    }

    await saveState();
    await syncSource();

    if (added) {
      var noun = added === 1 ? " torrent" : " torrents";
      if (viaQb === added) toast(added + noun + " añadido" + (added === 1 ? "" : "s") + " a qBittorrent", "success");
      else if (viaQb === 0) toast(added + noun + " abierto" + (added === 1 ? "" : "s") + " en tu cliente", "success");
      else toast(added + noun + " añadido" + (added === 1 ? "" : "s") + " (" + viaQb + " a qBittorrent)", "success");
    } else if (duplicates) {
      toast("Ya estaba en TorrentLy", "info");
    }

    if (added) {
      state.ui.view = "list";
      paintIfSafe();
      refreshHost();
    }

    return { added: added, duplicates: duplicates };
  }

  async function togglePause(entry) {
    if (!isQbConnected() || !entry.infoHash) {
      toast("Pausar solo está disponible con qBittorrent", "info", 4000);
      return;
    }
    var l = liveFor(entry);
    var paused = l && /^(paused|stopped)/.test(l.state || "");
    try {
      await engine.client.setPaused(entry.infoHash, !paused);
      toast(paused ? "Reanudado" : "Pausado", "info");
      pollOnce();
    } catch (err) {
      toast("No se pudo cambiar el estado: " + err.message, "error", 5000);
    }
  }

  function confirmRemove(entry) {
    var canDeleteFiles = isQbConnected() && entry.engine === "qbittorrent" && entry.infoHash;
    openModal({
      title: "Quitar torrent",
      html:
        '<p>Se quitará <strong>' + esc(entry.name) + "</strong> de TorrentLy.</p>" +
        (canDeleteFiles
          ? '<label class="trly-check"><input type="checkbox" id="trly-del-files"> Borrar también los archivos descargados</label>'
          : '<p class="trly-hint">No se tocará nada de tu cliente de torrents.</p>'),
      actions: [
        { label: "Cancelar" },
        {
          label: "Quitar",
          danger: true,
          onClick: async function (body) {
            var delFiles = !!(body.querySelector("#trly-del-files") && body.querySelector("#trly-del-files").checked);
            if (canDeleteFiles) {
              try {
                await engine.client.remove(entry.infoHash, delFiles);
              } catch (err) {
                toast("No se pudo quitar de qBittorrent: " + err.message, "error", 5000);
              }
            }
            removeFromLibrary(entry.id);
            await saveState();
            await syncSource();
            paintIfSafe();
            refreshHost();
            toast("Torrent quitado", "info");
          },
        },
      ],
    });
  }

  // ==========================================================================
  // 10. FUENTE ÚNICA «🧲 Torrents»
  // ==========================================================================

  function buildSourceItems(torrents) {
    var seen = {};
    var items = [];

    (torrents || []).forEach(function (t) {
      if (!t || !t.magnet) return;
      var key = t.infoHash || t.id || magnetKey(t.magnet);
      if (!key || seen[key]) return;
      seen[key] = 1;

      var bits = ["Torrent"];
      if (t.fileCount > 0) bits.push(t.fileCount + (t.fileCount === 1 ? " archivo" : " archivos"));
      if (t.totalSize > 0) bits.push(fmtBytes(t.totalSize));

      items.push({
        id: "tr-" + String(key).replace(/[^a-zA-Z0-9_-]/g, ""),
        source_id: state.sourceId || "",
        source_name: SOURCE_NAME,
        title: t.name || "Torrent",
        subtitle: bits.join(" · "),
        file_size: t.totalSize > 0 ? fmtBytes(t.totalSize) : null,
        file_size_bytes: t.totalSize > 0 ? t.totalSize : 0,
        link: t.magnet,
        raw: JSON.stringify({ torrently: true, infoHash: t.infoHash || "" }),
      });
    });

    return items;
  }

  async function syncSource() {
    if (!api || !api.sources) return;

    var enabled = state.settings.showInSearch && state.torrents.length > 0;

    if (!enabled) {
      if (state.sourceId && typeof api.sources.remove === "function") {
        try { await api.sources.remove(state.sourceId); } catch (e) { /* ya no existe */ }
        state.sourceId = null;
        await saveState();
      }
      return;
    }

    if (typeof api.sources.syncItems !== "function") {
      console.warn("[TorrentLy] El host no soporta sources.syncItems; se omite la fuente del buscador.");
      return;
    }

    try {
      var src = await api.sources.syncItems({
        sourceId: state.sourceId || undefined,
        name: SOURCE_NAME,
        items: buildSourceItems(state.torrents),
        flags: { isTorrentSource: true, managedByPlugin: true },
      });
      if (src && src.id && src.id !== state.sourceId) {
        state.sourceId = src.id;
        await saveState();
      }
    } catch (err) {
      console.warn("[TorrentLy] No se pudo sincronizar la fuente:", err);
    }
  }

  async function findLegacySources() {
    if (!api || !api.sources || typeof api.sources.list !== "function") return [];
    var list = await api.sources.list();
    return (list || []).filter(function (s) {
      if (!s || s.id === state.sourceId) return false;
      return /^🧲\s+/.test(s.name || "");
    });
  }

  async function consolidateLegacySources() {
    var legacy;
    try {
      legacy = await findLegacySources();
    } catch (err) {
      toast("No se pudieron leer las fuentes: " + err.message, "error", 5000);
      return;
    }

    if (!legacy.length) {
      toast("No hay fuentes «🧲 …» antiguas que consolidar", "info");
      return;
    }

    openModal({
      title: "Consolidar fuentes antiguas",
      html:
        "<p>TorrentLy 1.x creaba una fuente por torrent. Se han encontrado <strong>" + legacy.length + "</strong>:</p>" +
        '<p class="trly-hint">' + esc(legacy.map(function (s) { return s.name; }).join(" · ")) + "</p>" +
        "<p>Sus magnets se moverán a la fuente única <strong>«" + SOURCE_NAME + "»</strong> y después se eliminarán esas fuentes. Tus demás fuentes no se tocan.</p>",
      actions: [
        { label: "Cancelar" },
        {
          label: "Consolidar",
          primary: true,
          onClick: async function () {
            var moved = 0;
            for (var i = 0; i < legacy.length; i++) {
              var s = legacy[i];
              try {
                var items = typeof api.sources.getItems === "function" ? await api.sources.getItems(s.id) : [];
                (items || []).forEach(function (item) {
                  if (!item || !item.link || !/^magnet:\?/i.test(item.link)) return;
                  var parsed = parseMagnet(item.link);
                  if (!parsed) return;
                  var res = addToLibrary({
                    infoHash: parsed.infoHash || "",
                    name: item.title || parsed.name || "Torrent",
                    magnet: buildMagnet(parsed),
                    totalSize: parsed.size || 0,
                    trackers: parsed.trackers,
                    source: "migrated",
                  });
                  if (res && !res.duplicate) moved++;
                });
                await api.sources.remove(s.id);
              } catch (err) {
                console.warn("[TorrentLy] No se pudo consolidar", s.name, err);
              }
            }

            await saveState();
            await syncSource();
            paintIfSafe();
            refreshHost();
            toast("Consolidación completada: " + moved + (moved === 1 ? " torrent movido" : " torrents movidos"), "success", 6000);
          },
        },
      ],
    });
  }

  // ==========================================================================
  // 11. POLLING
  // ==========================================================================

  function hasActiveTransfers() {
    for (var i = 0; i < state.torrents.length; i++) {
      var l = liveFor(state.torrents[i]);
      if (l && ACTIVE_STATES[l.state]) return true;
    }
    return false;
  }

  async function pollOnce() {
    if (!isQbConnected()) return;

    try {
      var data = await engine.client.sync(rid);
      if (data.rid) rid = data.rid;

      if (data.full_update) live = {};

      if (data.torrents) {
        var dirty = false;
        Object.keys(data.torrents).forEach(function (h) {
          var normH = h.toLowerCase();
          live[normH] = Object.assign(live[normH] || {}, data.torrents[h]);
          var e = findEntryByHash(normH) || findEntry(normH);
          if (e && e.engine !== "qbittorrent") {
            e.engine = "qbittorrent";
            e.external = false;
            dirty = true;
          }
        });
        if (dirty) saveState();
      }
      if (Array.isArray(data.torrents_removed)) {
        data.torrents_removed.forEach(function (h) {
          delete live[h.toLowerCase()];
          delete live[h];
        });
      }
      if (data.server_state) {
        serverState = Object.assign(serverState, data.server_state);
      }

      if (engine.status !== "connected") {
        engine.status = "connected";
        engine.kind = "qbittorrent";
        engine.error = null;
      }

      paintIfSafe();
    } catch (err) {
      console.warn("[TorrentLy] Error en sondeo:", err);
      engine.error = err.message || String(err);
      if (/403|AUTH/i.test(engine.error)) {
        engine.status = "auth";
        engine.kind = "external";
      } else {
        engine.status = "offline";
        engine.kind = "external";
      }
      paintIfSafe();
    }
  }

  function scheduleNextPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    if (!isQbConnected()) {
      // Si qBittorrent no está disponible, reintentamos la detección cada 20 s
      // (modo automático). Así se reconecta solo si el usuario lo arranca.
      if (state.settings.mode !== "external" && state.loaded) {
        pollTimer = setTimeout(async function () {
          await resolveEngine(true);
          if (isQbConnected()) {
            await pollOnce();
          }
          scheduleNextPoll();
        }, 20000);
      }
      return;
    }

    var interval = document.hidden
      ? POLL_HIDDEN_MS
      : (hasActiveTransfers() ? POLL_ACTIVE_MS : POLL_IDLE_MS);

    pollTimer = setTimeout(async function () {
      await pollOnce();
      scheduleNextPoll();
    }, interval);
  }

  // ==========================================================================
  // 12. UI · ESTILOS
  // ==========================================================================

  function ensureStyles() {
    var ex = document.getElementById("trly-styles"); if (ex) ex.remove();
    var s = document.createElement("style");
    s.id = "trly-styles";
    s.textContent = [
      ".trly-root{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--color-text-secondary,#94a3b8);font-size:13px;line-height:1.4}",
      ".trly-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
      ".trly-brand{display:flex;align-items:center;gap:12px;min-width:0}",
      ".trly-logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:20px;flex-shrink:0;background:linear-gradient(135deg,rgba(14,165,233,.22),rgba(14,165,233,.04));border:1px solid rgba(14,165,233,.30);box-shadow:0 2px 8px rgba(14,165,233,.15)}",
      ".trly-brand h4{margin:0;font-size:16px;font-weight:700;color:var(--color-text,#f1f5f9);line-height:1.2}",
      ".trly-brand small{font-size:11.5px;color:var(--color-text-tertiary,#64748b)}",
      ".trly-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".trly-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:8px;color:var(--color-text-secondary,#94a3b8);padding:6px 12px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;line-height:1;white-space:nowrap;user-select:none;transition:all .15s cubic-bezier(.4,0,.2,1)}",
      ".trly-btn:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18);color:var(--color-text,#f1f5f9);transform:translateY(-1px)}",
      ".trly-btn:active{transform:translateY(0) scale(.98)}",
      ".trly-btn:focus-visible{outline:2px solid var(--color-primary,#0ea5e9);outline-offset:2px}",
      ".trly-btn:disabled{opacity:.45;cursor:not-allowed;transform:none!important}",
      ".trly-btn-primary{background:linear-gradient(135deg,#0284c7 0%,#0ea5e9 100%);border-color:rgba(14,165,233,.4);color:#fff;font-weight:600;box-shadow:0 2px 8px rgba(14,165,233,.25)}",
      ".trly-btn-primary:hover{background:linear-gradient(135deg,#0369a1 0%,#0284c7 100%);border-color:rgba(14,165,233,.6);color:#fff;box-shadow:0 4px 12px rgba(14,165,233,.35)}",
      ".trly-btn-success{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.30);color:#4ade80;font-weight:600}",
      ".trly-btn-success:hover{background:rgba(34,197,94,.22);border-color:rgba(34,197,94,.48);color:#86efac}",
      ".trly-btn-warn{background:rgba(245,158,11,.10);border-color:rgba(245,158,11,.28);color:#fbbf24;font-weight:500}",
      ".trly-btn-warn:hover{background:rgba(245,158,11,.20);border-color:rgba(245,158,11,.45);color:#fde68a}",
      ".trly-btn-danger{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.22);color:#f87171}",
      ".trly-btn-danger:hover{background:rgba(239,68,68,.18);border-color:rgba(239,68,68,.40);color:#fca5a5}",
      ".trly-btn-ghost{background:transparent;border-color:transparent}",
      ".trly-btn-ghost:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.10)}",
      ".trly-btn-sm{padding:5px 10px;font-size:11.5px;border-radius:6px}",
      ".trly-btn-icon{padding:6px;min-width:32px;height:32px;font-size:13px;border-radius:8px}",
      ".trly-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:10px;background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.24);color:var(--color-text-secondary,#94a3b8);font-size:12px}",
      ".trly-banner.warn{background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.28)}",
      ".trly-banner .trly-btn{margin-left:auto}",
      ".trly-stats{display:flex;gap:16px;flex-wrap:wrap;padding:8px 14px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(255,255,255,.02);font-size:12px;align-items:center}",
      ".trly-stats span{display:inline-flex;align-items:center;gap:4px;color:var(--color-text-tertiary,#94a3b8)}",
      ".trly-stats b{color:var(--color-text,#f1f5f9);font-weight:600}",
      ".trly-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
      ".trly-chip{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:20px;color:var(--color-text-secondary,#94a3b8);padding:4px 12px;font-size:11.5px;font-weight:500;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;transition:all .15s ease}",
      ".trly-chip:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);color:var(--color-text,#f1f5f9)}",
      ".trly-chip[aria-pressed='true']{background:rgba(14,165,233,.14);border-color:rgba(14,165,233,.4);color:#38bdf8;font-weight:600}",
      ".trly-chip-count{background:rgba(255,255,255,.08);border-radius:10px;padding:1px 6px;font-size:10.5px;font-variant-numeric:tabular-nums}",
      ".trly-chip[aria-pressed='true'] .trly-chip-count{background:rgba(14,165,233,.25);color:#fff}",
      ".trly-list{display:flex;flex-direction:column;gap:10px}",
      ".trly-item{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.025);box-shadow:0 2px 6px rgba(0,0,0,.15);transition:all .2s ease}",
      ".trly-item:hover{border-color:rgba(14,165,233,.28);background:rgba(255,255,255,.04);box-shadow:0 4px 16px rgba(0,0,0,.25)}",
      ".trly-item-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}",
      ".trly-name{font-size:13.5px;font-weight:600;color:var(--color-text,#f1f5f9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}",
      ".trly-item-badges{display:flex;align-items:center;gap:8px;flex-shrink:0}",
      ".trly-pct{font-variant-numeric:tabular-nums;font-size:12px;font-weight:700;color:var(--color-text,#f1f5f9)}",
      ".trly-badge-status{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;line-height:1.3;white-space:nowrap}",
      ".trly-badge-status::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}",
      ".trly-badge-green{background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.25)}",
      ".trly-badge-blue{background:rgba(59,130,246,.12);color:#60a5fa;border:1px solid rgba(59,130,246,.25)}",
      ".trly-badge-amber{background:rgba(245,158,11,.12);color:#fbbf24;border:1px solid rgba(245,158,11,.25)}",
      ".trly-badge-red{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25)}",
      ".trly-badge-purple{background:rgba(168,85,247,.12);color:#c084fc;border:1px solid rgba(168,85,247,.25)}",
      ".trly-badge-cyan{background:rgba(6,182,212,.12);color:#22d3ee;border:1px solid rgba(6,182,212,.25)}",
      ".trly-badge-gray{background:rgba(148,163,184,.10);color:#94a3b8;border:1px solid rgba(148,163,184,.20)}",
      ".trly-bar{height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}",
      ".trly-bar>i{display:block;height:100%;background:linear-gradient(90deg,#0284c7,#38bdf8);border-radius:999px;transition:width .4s ease;box-shadow:0 0 8px rgba(14,165,233,.4)}",
      ".trly-bar.done>i{background:linear-gradient(90deg,#16a34a,#4ade80);box-shadow:0 0 8px rgba(34,197,94,.4)}",
      ".trly-bar.err>i{background:linear-gradient(90deg,#dc2626,#f87171);box-shadow:0 0 8px rgba(239,68,68,.4)}",
      ".trly-item-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:2px}",
      ".trly-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--color-text-tertiary,#64748b);align-items:center}",
      ".trly-meta span{display:inline-flex;align-items:center;gap:4px}",
      ".trly-meta b{color:var(--color-text-secondary,#cbd5e1);font-weight:600}",
      ".trly-item-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto}",
      ".trly-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 20px;border:1px dashed rgba(255,255,255,.12);border-radius:14px;text-align:center;background:rgba(255,255,255,.01)}",
      ".trly-empty .trly-logo{width:54px;height:54px;font-size:26px}",
      ".trly-empty h5{margin:0;font-size:15px;color:var(--color-text,#f1f5f9)}",
      ".trly-empty p{margin:0;max-width:460px;font-size:12.5px;line-height:1.5;color:var(--color-text-tertiary,#64748b)}",
      ".trly-card{border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;background:rgba(255,255,255,.025);display:flex;flex-direction:column;gap:12px}",
      ".trly-card h5{margin:0;font-size:14px;color:var(--color-text,#f1f5f9)}",
      ".trly-label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--color-text-tertiary,#94a3b8)}",
      ".trly-input{background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.10);border-radius:8px;padding:9px 12px;color:var(--color-text,#f1f5f9);font-family:inherit;font-size:12.5px;outline:none;transition:border-color .15s}",
      ".trly-input:focus{border-color:var(--color-primary,#0ea5e9)}",
      ".trly-textarea{resize:vertical;min-height:86px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}",
      ".trly-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".trly-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-secondary,#cbd5e1);cursor:pointer}",
      ".trly-hint{margin:0;font-size:11.5px;line-height:1.5;color:var(--color-text-tertiary,#64748b)}",
      ".trly-radio-row{display:flex;flex-direction:column;gap:8px}",
      ".trly-tabs{display:flex;gap:8px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:10px;flex-wrap:wrap;align-items:center}",
      ".trly-tab{background:transparent;border:none;color:var(--color-text-secondary,#94a3b8);padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:8px;cursor:pointer;transition:all .15s ease}",
      ".trly-tab:hover{background:rgba(255,255,255,.05);color:var(--color-text,#f1f5f9)}",
      ".trly-tab[aria-selected='true']{background:rgba(14,165,233,.12);color:#38bdf8}",
      ".trly-table{width:100%;border-collapse:collapse;font-size:12px}",
      ".trly-table th,.trly-table td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:middle}",
      ".trly-table th{font-weight:600;color:var(--color-text-tertiary,#64748b)}",
      ".trly-table td{color:var(--color-text-secondary,#cbd5e1)}",
      ".trly-table td.num,.trly-table th.num{text-align:right;font-variant-numeric:tabular-nums}",
      ".trly-truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:380px;vertical-align:middle}",
      ".trly-hidden{display:none!important}",
      ".trly-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:grid;place-items:center;z-index:99999;padding:20px;box-sizing:border-box}",
      ".trly-dialog{background:#0f172a;border:1px solid rgba(255,255,255,.14);border-radius:14px;max-width:500px;width:100%;box-shadow:0 24px 48px -8px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.05);display:flex;flex-direction:column;overflow:hidden;color:var(--color-text,#f1f5f9);box-sizing:border-box}",
      ".trly-dialog-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02)}",
      ".trly-dialog-head h4{margin:0;font-size:15.5px;font-weight:700;color:var(--color-text,#f1f5f9);line-height:1.2}",
      ".trly-dialog-head .trly-btn{padding:4px 8px;min-width:28px;height:28px}",
      ".trly-dialog-body{padding:20px;display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:1.5;color:var(--color-text-secondary,#cbd5e1);box-sizing:border-box}",
      ".trly-dialog-body p{margin:0}",
      ".trly-dialog-body strong{color:var(--color-text,#f1f5f9);font-weight:600}",
      ".trly-dialog-foot{display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;border-top:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);align-items:center}",
      ".trly-textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:96px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5}"
    ].join("");
    document.head.appendChild(s);
  }

  // ==========================================================================
  // 13. UI · MODAL PROPIO (focus trap + Escape)
  // ==========================================================================

  var modalCleanup = null;

  function closeModal() {
    if (modalCleanup) {
      try { modalCleanup(); } catch (e) { /* nada */ }
      modalCleanup = null;
    }
    var existing = document.getElementById("trly-modal");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function openModal(opts) {
    closeModal();
    opts = opts || {};

    var overlay = el("div", "trly-overlay");
    overlay.id = "trly-modal";

    var dialog = el("div", "trly-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", opts.title || "TorrentLy");

    var head = el("div", "trly-dialog-head");
    head.appendChild(el("h4", "", opts.title || "TorrentLy"));
    var closeBtn = el("button", "trly-btn trly-icon", "✕");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cerrar");
    closeBtn.addEventListener("click", closeModal);
    head.appendChild(closeBtn);

    var body = el("div", "trly-dialog-body");
    if (typeof opts.html === "string") body.innerHTML = opts.html;
    else if (typeof opts.render === "function") opts.render(body);

    var foot = el("div", "trly-dialog-foot");
    (opts.actions || []).forEach(function (act) {
      var b = el("button", "trly-btn" + (act.primary ? " trly-btn-primary" : "") + (act.danger ? " trly-btn-danger" : ""), act.label || "OK");
      b.type = "button";
      b.addEventListener("click", async function () {
        var keep = false;
        if (typeof act.onClick === "function") {
          try {
            keep = (await act.onClick(body, b)) === false;
          } catch (err) {
            console.error("[TorrentLy] Error en acción del modal:", err);
            toast(err.message || String(err), "error", 5000);
          }
        }
        if (!keep) closeModal();
      });
      foot.appendChild(b);
    });

    dialog.appendChild(head);
    dialog.appendChild(body);
    if (foot.childNodes.length) dialog.appendChild(foot);
    overlay.appendChild(dialog);

    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) closeModal();
    });

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key !== "Tab") return;
      var focusables = dialog.querySelectorAll("button,[href],input,select,textarea,[tabindex]:not([tabindex='-1'])");
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);

    modalCleanup = function () {
      document.removeEventListener("keydown", onKey, true);
    };

    var target = body.querySelector("textarea,input,select,button");
    if (target) {
      setTimeout(function () {
        try { target.focus(); } catch (e) { /* nada */ }
      }, 30);
    }

    return { body: body, close: closeModal };
  }

  // ==========================================================================
  // 14. UI · VISTAS
  // ==========================================================================

  function statusOf(entry) {
    var l = liveFor(entry);
    if (l && l.state) return STATE_LABELS[l.state] || l.state;
    if (entry.engine === "qbittorrent") return "En qBittorrent";
    if (entry.external) return "Abierto en tu cliente";
    return "En la biblioteca";
  }

  function progressOf(entry) {
    var l = liveFor(entry);
    if (l && typeof l.progress === "number") return l.progress;
    if (l && l.size && l.completed) return l.completed / l.size;
    return null;
  }

  function filteredTorrents() {
    var f = state.ui.filter;
    return state.torrents.filter(function (t) {
      var l = liveFor(t);
      var p = progressOf(t);
      if (f === "downloading") return !!l && !!ACTIVE_STATES[l.state];
      if (f === "done") return p != null && p >= 1;
      if (f === "paused") return !!l && /^(paused|stopped)/.test(l.state || "");
      if (f === "external") return !l || t.engine !== "qbittorrent";
      return true;
    });
  }

  function headerHtml() {
    var banner = "";
    if (state.settings.mode !== "external" && (engine.status === "offline" || engine.status === "auth")) {
      banner =
        '<div class="trly-banner warn" role="status">' +
        "<span>" +
        (engine.status === "auth"
          ? "qBittorrent está abierto pero pide usuario y contraseña. Mientras tanto, los magnets se abrirán en tu cliente por defecto."
          : "No se detectó qBittorrent. Los magnets se abrirán en tu cliente de torrents por defecto.") +
        "</span>" +
        '<button type="button" class="trly-btn" data-trly-act="settings">Configurar</button>' +
        "</div>";
    }

    var stats = "";
    if (isQbConnected()) {
      stats =
        '<div class="trly-stats" aria-live="polite">' +
        "<span>↓ <b>" + esc(fmtSpeed(serverState.dl_info_speed)) + "</b></span>" +
        "<span>↑ <b>" + esc(fmtSpeed(serverState.up_info_speed)) + "</b></span>" +
        "<span>Libre: <b>" + esc(fmtBytes(serverState.free_space_on_disk)) + "</b></span>" +
        "<span>Activos: <b>" + state.torrents.filter(function (t) { var l = liveFor(t); return l && ACTIVE_STATES[l.state]; }).length + "</b></span>" +
        "</div>";
    }

    return (
      '<div class="trly-head">' +
        '<div class="trly-brand">' +
          '<div class="trly-logo" aria-hidden="true">🧲</div>' +
          '<div class="trly-brand-txt"><h4>TorrentLy</h4><small>' + esc(engineLabel()) + "</small></div>" +
        "</div>" +
        '<div class="trly-actions">' +
          '<button type="button" class="trly-btn trly-btn-primary" data-trly-act="add"><span>➕ Añadir magnet</span></button>' +
          '<button type="button" class="trly-btn" data-trly-act="open-file"><span>📂 Abrir .torrent</span></button>' +
          '<button type="button" class="trly-btn trly-icon" data-trly-act="refresh" title="Actualizar" aria-label="Actualizar">↻</button>' +
          '<button type="button" class="trly-btn trly-icon" data-trly-act="settings" title="Ajustes" aria-label="Ajustes">⚙</button>' +
        "</div>" +
      "</div>" +
      banner +
      stats +
      '<input type="file" id="trly-file-input" class="trly-hidden" accept=".torrent,application/x-bittorrent" multiple>'
    );
  }

  function statusBadge(entry, l, pct) {
    var done = pct != null && pct >= 1;
    if (l) {
      var st = l.state || "";
      if (/^(downloading|forcedDL)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-green">Descargando</span>';
      }
      if (/^(uploading|forcedUP)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-blue">Compartiendo</span>';
      }
      if (/^(stalledDL)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-amber">Esperando fuentes</span>';
      }
      if (/^(stalledUP)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-blue">Sembrando</span>';
      }
      if (/^(pausedDL|stoppedDL)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-amber">En pausa</span>';
      }
      if (/^(pausedUP|stoppedUP)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-gray">Pausado</span>';
      }
      if (/^(queuedDL|queuedUP)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-cyan">En cola</span>';
      }
      if (/^(checking)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-cyan">Verificando</span>';
      }
      if (/^(error|missingFiles)/.test(st)) {
        return '<span class="trly-badge-status trly-badge-red">Error</span>';
      }
      if (done) {
        return '<span class="trly-badge-status trly-badge-green">Completado</span>';
      }
      return '<span class="trly-badge-status trly-badge-gray">' + esc(STATE_LABELS[st] || st) + '</span>';
    }

    if (entry.engine === "qbittorrent") {
      return '<span class="trly-badge-status trly-badge-cyan">En qBittorrent</span>';
    }
    if (entry.external) {
      return '<span class="trly-badge-status trly-badge-purple">Cliente externo</span>';
    }
    return '<span class="trly-badge-status trly-badge-gray">En biblioteca</span>';
  }

  function chipsHtml() {
    var counts = {
      all: state.torrents.length,
      downloading: 0,
      done: 0,
      paused: 0,
      external: 0,
    };
    state.torrents.forEach(function (t) {
      var l = liveFor(t);
      var p = progressOf(t);
      if (l && ACTIVE_STATES[l.state]) counts.downloading++;
      if (p != null && p >= 1) counts.done++;
      if (l && /^(paused|stopped)/.test(l.state || "")) counts.paused++;
      if (!l || t.engine !== "qbittorrent") counts.external++;
    });

    var defs = [
      ["all", "Todos"],
      ["downloading", "Descargando"],
      ["done", "Completados"],
      ["paused", "Pausados"],
      ["external", "Externos"],
    ];

    return (
      '<div class="trly-chips">' +
      defs.map(function (d) {
        var active = state.ui.filter === d[0];
        return (
          '<button type="button" class="trly-chip" data-trly-act="filter" data-filter="' + d[0] + '" aria-pressed="' + active + '">' +
            '<span>' + esc(d[1]) + '</span>' +
            '<span class="trly-chip-count">' + (counts[d[0]] || 0) + '</span>' +
          '</button>'
        );
      }).join("") +
      '</div>'
    );
  }

  function itemHtml(entry) {
    var l = liveFor(entry);
    var p = progressOf(entry);
    var pct = p == null ? null : Math.max(0, Math.min(1, p));
    var done = pct != null && pct >= 1;
    var err = l && /^(error|missingFiles)$/.test(l.state || "");
    var paused = l && /^(paused|stopped)/.test(l.state || "");

    var barCls = "trly-bar" + (done ? " done" : err ? " err" : "");
    var bar = pct == null
      ? '<div class="trly-meta"><span style="color:var(--color-text-tertiary,#64748b)">Sin progreso en tiempo real: gestionado por cliente externo</span></div>'
      : '<div class="' + barCls + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct * 100) + '"><i style="width:' + (pct * 100).toFixed(1) + '%"></i></div>';

    var meta = [];
    if (l) {
      if (l.dlspeed > 0) meta.push('<span style="color:#38bdf8">↓ <b>' + esc(fmtSpeed(l.dlspeed)) + '</b></span>');
      if (l.upspeed > 0) meta.push('<span style="color:#4ade80">↑ <b>' + esc(fmtSpeed(l.upspeed)) + '</b></span>');
      if (typeof l.num_seeds === "number" && l.num_seeds >= 0) meta.push('<span>Semillas: <b>' + l.num_seeds + '</b></span>');
      if (typeof l.num_leechs === "number" && l.num_leechs >= 0) meta.push('<span>Peers: <b>' + l.num_leechs + '</b></span>');
      if (l.eta != null && l.eta >= 0 && pct != null && pct < 1) meta.push('<span>ETA: <b>' + esc(fmtEta(l.eta)) + '</b></span>');
    }
    if (entry.totalSize > 0) meta.push('<span>Tamaño: <b>' + esc(fmtBytes(entry.totalSize)) + '</b></span>');
    if (entry.fileCount > 0) meta.push('<span>Archivos: <b>' + entry.fileCount + '</b></span>');

    var actions = [];

    // Botón contextual inteligente (Pausar / Reanudar / Descargar en qB)
    if (isQbConnected() && (entry.engine === "qbittorrent" || !!l)) {
      if (paused) {
        actions.push(
          '<button type="button" class="trly-btn trly-btn-sm trly-btn-success" data-trly-act="toggle" data-id="' + esc(entry.id) + '" title="Reanudar descarga">' +
            '<span>▶ Reanudar</span>' +
          '</button>'
        );
      } else if (l && (ACTIVE_STATES[l.state] || /^(downloading|uploading|stalled|queued|checking)/.test(l.state || ""))) {
        actions.push(
          '<button type="button" class="trly-btn trly-btn-sm trly-btn-warn" data-trly-act="toggle" data-id="' + esc(entry.id) + '" title="Pausar">' +
            '<span>⏸ Pausar</span>' +
          '</button>'
        );
      } else if (done) {
        actions.push(
          '<button type="button" class="trly-btn trly-btn-sm trly-btn-ghost" data-trly-act="toggle" data-id="' + esc(entry.id) + '" title="Sembrar / Pausar">' +
            '<span>' + (paused ? '▶ Sembrar' : '⏸ Pausar') + '</span>' +
          '</button>'
        );
      }
    } else if (entry.external && isQbConnected() && entry.magnet) {
      actions.push(
        '<button type="button" class="trly-btn trly-btn-sm trly-btn-primary" data-trly-act="import-qb" data-id="' + esc(entry.id) + '" title="Pasar descarga a qBittorrent">' +
          '<span>⬇ Descargar en qB</span>' +
        '</button>'
      );
    }

    // Botón Abrir carpeta
    if ((done || (l && l.save_path)) && isQbConnected()) {
      actions.push(
        '<button type="button" class="trly-btn trly-btn-sm" data-trly-act="folder" data-id="' + esc(entry.id) + '" title="Abrir carpeta en el explorador">' +
          '<span>📁 Carpeta</span>' +
        '</button>'
      );
    }

    // Botón Abrir en cliente externo
    actions.push(
      '<button type="button" class="trly-btn trly-btn-sm trly-btn-ghost" data-trly-act="external" data-id="' + esc(entry.id) + '" title="Abrir en cliente de torrents externo">' +
        '<span>↗ Abrir</span>' +
      '</button>'
    );

    // Botón Detalles
    actions.push(
      '<button type="button" class="trly-btn trly-btn-sm" data-trly-act="detail" data-id="' + esc(entry.id) + '" title="Ver detalles y archivos">' +
        '<span>ℹ Detalles</span>' +
      '</button>'
    );

    // Botón Quitar
    actions.push(
      '<button type="button" class="trly-btn trly-btn-sm trly-btn-danger" data-trly-act="remove" data-id="' + esc(entry.id) + '" title="Quitar de la biblioteca">' +
        '<span>✕ Quitar</span>' +
      '</button>'
    );

    return (
      '<div class="trly-item" data-id="' + esc(entry.id) + '">' +
        '<div class="trly-item-head">' +
          '<span class="trly-name" title="' + esc(entry.name) + '">' + esc(entry.name) + '</span>' +
          '<div class="trly-item-badges">' +
            statusBadge(entry, l, pct) +
            (pct != null ? '<span class="trly-pct">' + esc(fmtPercent(pct)) + '</span>' : '') +
          '</div>' +
        '</div>' +
        bar +
        '<div class="trly-item-foot">' +
          '<div class="trly-meta">' + meta.join("") + '</div>' +
          '<div class="trly-item-actions">' +
            actions.join("") +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function listHtml() {
    if (!state.torrents.length) {
      return (
        '<div class="trly-empty">' +
          '<div class="trly-logo" aria-hidden="true">🧲</div>' +
          '<h5>Tu biblioteca de torrents está vacía</h5>' +
          '<p>Añade un enlace magnet o abre un archivo <code>.torrent</code>. TorrentLy gestionará las descargas automáticamente con qBittorrent o con tu cliente por defecto.</p>' +
          '<div class="trly-row">' +
            '<button type="button" class="trly-btn trly-btn-primary" data-trly-act="add"><span>➕ Añadir magnet</span></button>' +
            '<button type="button" class="trly-btn" data-trly-act="open-file"><span>📂 Abrir .torrent</span></button>' +
          '</div>' +
        '</div>'
      );
    }

    var list = filteredTorrents();
    if (!list.length) {
      return '<div class="trly-empty"><h5>Nada por aquí</h5><p>No hay torrents que coincidan con este filtro.</p></div>';
    }

    return '<div class="trly-list">' + list.map(itemHtml).join("") + '</div>';
  }

  function detailGeneral(entry, l) {
    var rows = [
      ["Estado", statusOf(entry)],
      ["Tamaño", entry.totalSize > 0 ? fmtBytes(entry.totalSize) : (l && l.size ? fmtBytes(l.size) : "—")],
      ["Progreso", progressOf(entry) == null ? "—" : fmtPercent(progressOf(entry))],
      ["Descargado", l && l.completed ? fmtBytes(l.completed) : "—"],
      ["Subido", l && l.uploaded ? fmtBytes(l.uploaded) : "—"],
      ["Ratio", l && typeof l.ratio === "number" ? l.ratio.toFixed(2) : "—"],
      ["Velocidad", l ? fmtSpeed(l.dlspeed) + " ↓ · " + fmtSpeed(l.upspeed) + " ↑" : "—"],
      ["Semillas / Peers", l && typeof l.num_seeds === "number" ? l.num_seeds + " / " + (l.num_leechs || 0) : "—"],
      ["ETA", l && l.eta != null ? fmtEta(l.eta) : "—"],
      ["Guardado en", (l && l.save_path) || state.settings.savePath || "—"],
      ["Añadido", fmtDate(entry.addedAt)],
      ["Info hash", entry.infoHash || "—"],
      ["Origen", entry.source || "manual"],
    ];

    return (
      '<table class="trly-table"><tbody>' +
      rows.map(function (r) {
        return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
      }).join("") +
      "</tbody></table>" +
      '<div class="trly-row">' +
        '<button type="button" class="trly-btn" data-trly-act="copy" data-id="' + esc(entry.id) + '"><span>📋 Copiar magnet</span></button>' +
        '<button type="button" class="trly-btn" data-trly-act="external" data-id="' + esc(entry.id) + '"><span>↗ Abrir en cliente</span></button>' +
        ((l && l.save_path) ? '<button type="button" class="trly-btn" data-trly-act="folder" data-id="' + esc(entry.id) + '"><span>📁 Abrir carpeta</span></button>' : "") +
      "</div>"
    );
  }

  function detailFiles(entry) {
    var info = state.ui.files[entry.id];
    if (!info || info.loading) {
      return '<p class="trly-hint">Cargando archivos…</p>';
    }
    if (info.error) {
      return '<p class="trly-hint">' + esc(info.error) + "</p>";
    }
    if (!info.list || !info.list.length) {
      return '<p class="trly-hint">qBittorrent todavía no conoce los archivos de este torrent.</p>';
    }

    var sel = state.ui.fileSel[entry.id] || {};
    var total = 0;
    info.list.forEach(function (f) { total += Number(f.size) || 0; });

    return (
      '<div class="trly-row" style="justify-content:flex-end">' +
        '<button type="button" class="trly-btn" data-trly-act="files-all" data-id="' + esc(entry.id) + '" data-on="1">Todos</button>' +
        '<button type="button" class="trly-btn" data-trly-act="files-all" data-id="' + esc(entry.id) + '" data-on="0">Ninguno</button>' +
        '<button type="button" class="trly-btn trly-btn-primary" data-trly-act="files-apply" data-id="' + esc(entry.id) + '">Aplicar selección</button>' +
      "</div>" +
      '<table class="trly-table"><thead><tr><th>Archivo</th><th class="num">Tamaño</th><th class="num">Progreso</th></tr></thead><tbody>' +
      info.list.map(function (f) {
        var idx = f.index != null ? f.index : 0;
        var checked = sel[idx] === undefined ? true : !!sel[idx];
        return (
          "<tr><td>" +
            '<label class="trly-check"><input type="checkbox" data-trly-file="' + idx + '" data-id="' + esc(entry.id) + '"' + (checked ? " checked" : "") + ">" +
            '<span class="trly-truncate" title="' + esc(f.name) + '">' + esc(f.name) + "</span></label>" +
            '</td><td class="num">' + esc(fmtBytes(f.size)) + "</td>" +
            '<td class="num">' + esc(fmtPercent(f.progress || 0)) + "</td></tr>"
        );
      }).join("") +
      '</tbody><tfoot><tr><th>Total</th><th class="num">' + esc(fmtBytes(total)) + "</th><th></th></tr></tfoot></table>"
    );
  }

  function detailTrackers(entry) {
    var info = state.ui.files[entry.id + ":trackers"];
    if (info && info.loading) return '<p class="trly-hint">Cargando trackers…</p>';

    var list = (info && info.list) || (entry.trackers || []).map(function (url) {
      return { url: url, status: null, num_peers: null };
    });

    if (!list.length) return '<p class="trly-hint">Este torrent no declara trackers (puede funcionar por DHT).</p>';

    return '<table class="trly-table"><thead><tr><th>Tracker</th><th class="num">Peers</th><th>Estado</th></tr></thead><tbody>' +
      list.map(function (t) {
        var label = t.status === 2 ? "Funciona" : t.status === 4 ? "No funciona" : t.status === 3 ? "Actualizando" : "—";
        return "<tr><td>" + esc(t.url || "—") + '</td><td class="num">' + (t.num_peers == null ? "—" : t.num_peers) + "</td><td>" + esc(label) + "</td></tr>";
      }).join("") +
      "</tbody></table>";
  }

  function detailHtml() {
    var entry = findEntry(state.ui.hash);
    if (!entry) {
      state.ui.view = "list";
      return listHtml();
    }

    var l = liveFor(entry);
    var tab = state.ui.detailTab || "general";
    var body = tab === "files" ? detailFiles(entry) : tab === "trackers" ? detailTrackers(entry) : detailGeneral(entry, l);

    return (
      '<div class="trly-row">' +
        '<button type="button" class="trly-btn" data-trly-act="back">← Volver</button>' +
      "</div>" +
      '<div class="trly-brand" style="align-items:flex-start">' +
        '<div class="trly-logo" aria-hidden="true">🧲</div>' +
        '<div class="trly-brand-txt"><h4 style="word-break:break-word">' + esc(entry.name) + "</h4>" +
        "<small>" + esc(statusOf(entry)) + (entry.totalSize ? " · " + esc(fmtBytes(entry.totalSize)) : "") + "</small></div>" +
      "</div>" +
      '<div class="trly-tabs" role="tablist">' +
        '<button type="button" class="trly-tab" role="tab" aria-selected="' + (tab === "general") + '" data-trly-act="tab" data-tab="general">General</button>' +
        '<button type="button" class="trly-tab" role="tab" aria-selected="' + (tab === "files") + '" data-trly-act="tab" data-tab="files">Archivos</button>' +
        '<button type="button" class="trly-tab" role="tab" aria-selected="' + (tab === "trackers") + '" data-trly-act="tab" data-tab="trackers">Trackers</button>' +
      "</div>" +
      '<div class="trly-card">' + body + "</div>"
    );
  }

  function settingsHtml() {
    var s = state.settings;
    var passwordSet = cachedPassword != null && cachedPassword !== "";

    return (
      '<div class="trly-row">' +
        '<button type="button" class="trly-btn" data-trly-act="back">← Volver</button>' +
        '<button type="button" class="trly-btn trly-btn-primary" data-trly-act="save-settings" style="margin-left:auto">Guardar cambios</button>' +
      "</div>" +

      '<div class="trly-card">' +
        "<h5>Motor de descargas</h5>" +
        '<div class="trly-radio-row">' +
          '<label class="trly-check"><input type="radio" name="trly-mode" value="auto"' + (s.mode === "auto" ? " checked" : "") + "> Automático (recomendado)</label>" +
          '<label class="trly-check"><input type="radio" name="trly-mode" value="qbittorrent"' + (s.mode === "qbittorrent" ? " checked" : "") + "> Solo qBittorrent</label>" +
          '<label class="trly-check"><input type="radio" name="trly-mode" value="external"' + (s.mode === "external" ? " checked" : "") + "> Solo cliente externo</label>" +
        "</div>" +
        '<p class="trly-hint">En modo automático, TorrentLy usa qBittorrent si responde en la URL indicada. Si no está, abre los magnets en tu cliente por defecto. No hay configuración obligatoria.</p>' +
        '<p class="trly-hint">Estado actual: <strong>' + esc(engineLabel()) + "</strong>" + (engine.error ? " · " + esc(engine.error) : "") + "</p>" +
      "</div>" +

      '<div class="trly-card">' +
        "<h5>qBittorrent (opcional)</h5>" +
        '<label class="trly-label">URL de la Web UI<input id="trly-qb-url" class="trly-input" type="text" value="' + esc(s.qbUrl) + '" placeholder="http://127.0.0.1:8080"></label>' +
        '<label class="trly-label">Usuario<input id="trly-qb-user" class="trly-input" type="text" value="' + esc(s.qbUsername) + '" autocomplete="username"></label>' +
        '<label class="trly-label">Contraseña<input id="trly-qb-pass" class="trly-input" type="password" value="" placeholder="' + (passwordSet ? "•••••••• (guardada)" : "sin contraseña") + '" autocomplete="current-password"></label>' +
        '<div class="trly-row">' +
          '<button type="button" class="trly-btn" data-trly-act="test-connection">Probar conexión</button>' +
          '<button type="button" class="trly-btn trly-btn-danger" data-trly-act="clear-password">Borrar contraseña</button>' +
        "</div>" +
        '<p class="trly-hint">Activa la Web UI en qBittorrent (Herramientas → Opciones → Web UI) o marca «Bypass authentication for clients on localhost». La contraseña se guarda en el llavero del sistema.</p>' +
      "</div>" +

      '<div class="trly-card">' +
        "<h5>Biblioteca</h5>" +
        '<label class="trly-check"><input type="checkbox" id="trly-show-search"' + (s.showInSearch ? " checked" : "") + "> Mostrar los torrents en el buscador de IndexLy (fuente única «" + SOURCE_NAME + "»)</label>" +
        '<label class="trly-check"><input type="checkbox" id="trly-pause-add"' + (s.addPaused ? " checked" : "") + "> Añadir a qBittorrent en pausa</label>" +
        '<label class="trly-label">Carpeta de descarga (vacío = la que use qBittorrent)<input id="trly-save-path" class="trly-input" type="text" value="' + esc(s.savePath) + '" placeholder="D:\\Descargas"></label>' +
        '<p class="trly-hint">Con cliente externo esta carpeta no se usa: la decide tu cliente de torrents.</p>' +
      "</div>" +

      '<div class="trly-card">' +
        "<h5>Mantenimiento</h5>" +
        '<p class="trly-hint">TorrentLy 1.x creaba una fuente «🧲 Nombre» por cada torrent. Esta acción las mueve a la fuente única y las elimina. Nunca se ejecuta sola.</p>' +
        '<div class="trly-row">' +
          '<button type="button" class="trly-btn" data-trly-act="consolidate">Consolidar fuentes antiguas…</button>' +
          '<button type="button" class="trly-btn trly-btn-danger" data-trly-act="reset">Restablecer biblioteca…</button>' +
        "</div>" +
      "</div>"
    );
  }

  function shellHtml() {
    if (!state.loaded) {
      return headerHtml() + '<div class="trly-empty"><h5>Cargando TorrentLy…</h5></div>';
    }
    var body;
    if (state.ui.view === "settings") body = settingsHtml();
    else if (state.ui.view === "detail") body = detailHtml();
    else body = chipsHtml() + listHtml();

    return headerHtml() + body +
      '<p class="trly-hint">TorrentLy no descarga nada por su cuenta: usa qBittorrent si está disponible o tu cliente de torrents por defecto.</p>';
  }

  function paint(root) {
    if (!root) return;
    var scroll = root.scrollTop || 0;
    root.innerHTML = shellHtml();
    root.scrollTop = scroll;
    lastPaint = Date.now();
  }

  function paintIfSafe() {
    if (!activeRoot) return;
    if (!document.body.contains(activeRoot)) return;
    if (state.ui.view === "settings") return;
    var ae = document.activeElement;
    if (ae && activeRoot.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    if (Date.now() - lastPaint < 700) return;
    paint(activeRoot);
  }

  // ==========================================================================
  // 15. UI · ACCIONES
  // ==========================================================================

  function openAddModal(prefill) {
    openModal({
      title: "Añadir torrent",
      html:
        '<label class="trly-label" for="trly-magnet-input">Magnet o URL de .torrent</label>' +
        '<textarea id="trly-magnet-input" class="trly-input trly-textarea" rows="4" placeholder="magnet:?xt=urn:btih:...">' + esc(prefill || "") + "</textarea>" +
        '<p class="trly-hint">Puedes pegar varias líneas, una por torrent.</p>',
      actions: [
        { label: "Cancelar" },
        {
          label: "Añadir",
          primary: true,
          onClick: async function (body) {
            var input = body.querySelector("#trly-magnet-input");
            var value = input ? input.value.trim() : "";
            if (!value) return false;
            await addTorrentInput(value, { source: "manual" });
          },
        },
      ],
    });
  }

  async function readSettingsForm(root) {
    if (!root) return;

    var modeEl = root.querySelector('input[name="trly-mode"]:checked');
    var urlEl = root.querySelector("#trly-qb-url");
    var userEl = root.querySelector("#trly-qb-user");
    var passEl = root.querySelector("#trly-qb-pass");
    var searchEl = root.querySelector("#trly-show-search");
    var pauseEl = root.querySelector("#trly-pause-add");
    var saveEl = root.querySelector("#trly-save-path");

    state.settings.mode = modeEl ? modeEl.value : "auto";
    state.settings.qbUrl = urlEl ? urlEl.value.trim() || DEFAULT_SETTINGS.qbUrl : state.settings.qbUrl;
    state.settings.qbUsername = userEl ? userEl.value.trim() : state.settings.qbUsername;
    state.settings.showInSearch = searchEl ? !!searchEl.checked : state.settings.showInSearch;
    state.settings.addPaused = pauseEl ? !!pauseEl.checked : state.settings.addPaused;
    state.settings.savePath = saveEl ? saveEl.value.trim() : state.settings.savePath;

    if (passEl && passEl.value) {
      await writePassword(passEl.value);
      passEl.value = "";
    }

    await saveState();
  }

  async function loadFiles(entry) {
    if (!entry) return;
    state.ui.files[entry.id] = { loading: true, error: null, list: [] };
    paintIfSafe();

    try {
      if (isQbConnected() && entry.infoHash) {
        var list = await engine.client.files(entry.infoHash);
        state.ui.files[entry.id] = { loading: false, error: null, list: list || [] };
      } else if (!entry.infoHash) {
        state.ui.files[entry.id] = { loading: false, error: "Este elemento no tiene info_hash de BitTorrent.", list: [] };
      } else {
        state.ui.files[entry.id] = { loading: false, error: "Conecta qBittorrent para ver los archivos de este torrent.", list: [] };
      }
    } catch (err) {
      state.ui.files[entry.id] = { loading: false, error: "No se pudieron cargar los archivos: " + (err.message || err), list: [] };
    }

    if (activeRoot) paint(activeRoot);
  }

  async function loadTrackers(entry) {
    if (!entry) return;
    var key = entry.id + ":trackers";
    state.ui.files[key] = { loading: true, error: null, list: [] };

    try {
      if (isQbConnected() && entry.infoHash) {
        var list = await engine.client.trackers(entry.infoHash);
        state.ui.files[key] = { loading: false, error: null, list: list || [] };
      } else {
        state.ui.files[key] = {
          loading: false,
          error: null,
          list: (entry.trackers || []).map(function (url) { return { url: url, status: null, num_peers: null }; }),
        };
      }
    } catch (err) {
      state.ui.files[key] = { loading: false, error: err.message || String(err), list: [] };
    }

    if (activeRoot) paint(activeRoot);
  }

  async function applyFileSelection(entry) {
    if (!entry || !isQbConnected() || !entry.infoHash) {
      toast("La selección de archivos requiere qBittorrent", "info", 4000);
      return;
    }
    var info = state.ui.files[entry.id];
    if (!info || !info.list || !info.list.length) return;

    var sel = state.ui.fileSel[entry.id] || {};
    var want = [];
    var skip = [];
    info.list.forEach(function (f) {
      var idx = f.index != null ? f.index : 0;
      var checked = sel[idx] === undefined ? true : !!sel[idx];
      (checked ? want : skip).push(idx);
    });

    try {
      if (skip.length) await engine.client.setFilePriority(entry.infoHash, skip, 0);
      if (want.length) await engine.client.setFilePriority(entry.infoHash, want, 1);
      toast("Selección aplicada", "success");
      await loadFiles(entry);
    } catch (err) {
      toast("No se pudo aplicar: " + (err.message || err), "error", 5000);
    }
  }

  async function openFolder(entry) {
    var l = liveFor(entry);
    var path = (l && l.save_path) || state.settings.savePath;
    if (!path) {
      toast("qBittorrent no ha indicado una carpeta todavía", "info", 4000);
      return;
    }
    try {
      await api.openLink(path);
    } catch (e) {
      toast("No se pudo abrir la carpeta", "error", 4000);
    }
  }

  async function resetLibrary() {
    openModal({
      title: "Restablecer biblioteca",
      html:
        "<p>Se vaciará la biblioteca de TorrentLy y se eliminará la fuente <strong>«" + SOURCE_NAME + "»</strong> del buscador.</p>" +
        '<p class="trly-hint">No se borran torrents ni archivos de tu cliente de torrents.</p>',
      actions: [
        { label: "Cancelar" },
        {
          label: "Restablecer",
          danger: true,
          onClick: async function () {
            if (state.sourceId && api.sources && typeof api.sources.remove === "function") {
              try { await api.sources.remove(state.sourceId); } catch (e) { /* nada */ }
            }
            state.torrents = [];
            state.sourceId = null;
            state.ui.view = "list";
            state.ui.hash = null;
            state.ui.files = {};
            state.ui.fileSel = {};
            await saveState();
            paintIfSafe();
            refreshHost();
            toast("Biblioteca restablecida", "info");
          },
        },
      ],
    });
  }

  async function handleAction(act, dataset, root) {
    var entry = dataset.id ? findEntry(dataset.id) : null;

    switch (act) {
      case "add":
        openAddModal();
        break;

      case "open-file": {
        var input = root.querySelector("#trly-file-input");
        if (input) input.click();
        break;
      }

      case "refresh":
        await resolveEngine(true);
        await pollOnce();
        scheduleNextPoll();
        paint(root);
        break;

      case "settings":
        state.ui.view = "settings";
        paint(root);
        readPassword().then(function () {
          if (state.ui.view === "settings") paint(root);
        });
        break;

      case "back":
        state.ui.view = "list";
        state.ui.hash = null;
        paint(root);
        break;

      case "filter":
        state.ui.filter = dataset.filter || "all";
        paint(root);
        break;

      case "detail":
        if (!entry) return;
        state.ui.view = "detail";
        state.ui.hash = entry.id;
        state.ui.detailTab = "general";
        paint(root);
        loadFiles(entry);
        break;

      case "tab": {
        if (!entry) return;
        state.ui.detailTab = dataset.tab || "general";
        paint(root);
        if (dataset.tab === "files") loadFiles(entry);
        if (dataset.tab === "trackers") loadTrackers(entry);
        break;
      }

      case "import-qb":
        if (entry) {
          if (await engineAdd(entry)) {
            entry.engine = "qbittorrent";
            entry.external = false;
            await saveState();
            await pollOnce();
            toast("Añadido a qBittorrent", "success");
            paint(root);
          }
        }
        break;

      case "toggle":
        if (entry) await togglePause(entry);
        break;

      case "external":
        if (entry) await openExternal(entry);
        break;

      case "remove":
        if (entry) confirmRemove(entry);
        break;

      case "copy":
        if (entry) {
          var ok = await copyText(entry.magnet);
          toast(ok ? "Magnet copiado" : "No se pudo copiar", ok ? "success" : "error");
        }
        break;

      case "folder":
        if (entry) await openFolder(entry);
        break;

      case "files-all": {
        if (!entry) return;
        var on = dataset.on === "1";
        var info = state.ui.files[entry.id];
        var sel = {};
        if (info && info.list) {
          info.list.forEach(function (f) {
            sel[f.index != null ? f.index : 0] = on;
          });
        }
        state.ui.fileSel[entry.id] = sel;
        paint(root);
        break;
      }

      case "files-apply":
        if (entry) await applyFileSelection(entry);
        break;

      case "save-settings":
        await readSettingsForm(root);
        await resolveEngine(true);
        if (isQbConnected()) {
          await pollOnce();
          scheduleNextPoll();
        }
        await syncSource();
        toast("Ajustes guardados", "success");
        state.ui.view = "list";
        paint(root);
        break;

      case "test-connection":
        await readSettingsForm(root);
        await resolveEngine(true);
        if (isQbConnected()) {
          await pollOnce();
          scheduleNextPoll();
          toast("Conectado a qBittorrent " + (engine.version || ""), "success", 5000);
        } else {
          toast("No se pudo conectar: " + (engine.error || "sin respuesta"), "error", 6000);
        }
        paint(root);
        break;

      case "clear-password":
        await clearPassword();
        toast("Contraseña borrada del llavero", "info");
        paint(root);
        break;

      case "consolidate":
        await consolidateLegacySources();
        break;

      case "reset":
        await resetLibrary();
        break;

      default:
        break;
    }
  }

  // ==========================================================================
  // 16. UI · EVENTOS DELEGADOS
  // ==========================================================================

  function bindRoot(root) {
    if (!root || root.dataset.trlyBound === "1") return;
    root.dataset.trlyBound = "1";

    root.addEventListener("click", function (e) {
      var target = e.target;
      while (target && target !== root && !(target.dataset && target.dataset.trlyAct)) {
        target = target.parentNode;
      }
      if (!target || target === root) return;
      var act = target.dataset.trlyAct;
      if (!act) return;
      e.preventDefault();
      handleAction(act, target.dataset, root).catch(function (err) {
        console.error("[TorrentLy] Acción fallida:", err);
        toast(err.message || String(err), "error", 5000);
      });
    });

    root.addEventListener("change", function (e) {
      var t = e.target;

      if (t && t.id === "trly-file-input") {
        var files = Array.prototype.slice.call(t.files || []);
        t.value = "";
        files.forEach(function (file) {
          if (!/\.torrent$/i.test(file.name)) {
            toast("Solo se aceptan archivos .torrent", "warning", 4000);
            return;
          }
          file.arrayBuffer().then(function (buf) {
            return addTorrentInput({ bytes: new Uint8Array(buf), fileName: file.name }, { source: "file" });
          }).catch(function (err) {
            toast("No se pudo leer " + file.name + ": " + (err.message || err), "error", 5000);
          });
        });
        return;
      }

      if (t && t.dataset && t.dataset.trlyFile != null) {
        var id = t.dataset.id;
        var idx = Number(t.dataset.trlyFile);
        var sel = state.ui.fileSel[id] || (state.ui.fileSel[id] = {});
        sel[idx] = !!t.checked;
        return;
      }
    });
  }

  function renderPage(root) {
    if (!root) return;
    activeRoot = root;
    root.classList.add("trly-root");
    bindRoot(root);
    paint(root);
  }

  // ==========================================================================
  // 17. INTEGRACIÓN CON EL BUSCADOR
  // ==========================================================================

  function decorateCard(e) {
    if (!e || !e.el || !e.game) return;
    var link = e.game.link;
    if (!link || !/^magnet:\?/i.test(link)) return;

    var key = magnetKey(link);
    var entry = key ? findEntryByHash(key) || findEntry(key) : null;
    if (!entry) return;
    if (e.el.querySelector(".trly-badge")) return;

    var info = e.el.querySelector(".game-info-container") || e.el.querySelector(".grid-body");
    if (!info) return;

    var badge = el("span", "trly-badge", "✓ En TorrentLy");
    badge.title = "En TorrentLy: " + entry.name;
    info.appendChild(badge);
  }

  // ==========================================================================
  // 18. ATAJOS: PEGAR Y ARRASTRAR
  // ==========================================================================

  function onWindowPaste(e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var text = (e.clipboardData && e.clipboardData.getData("text")) || "";
    text = text.trim();
    if (!/^magnet:\?/i.test(text)) return;
    e.preventDefault();
    addTorrentInput(text, { source: "paste" });
  }

  function onWindowDragOver(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return;
    for (var i = 0; i < types.length; i++) {
      if (types[i] === "Files") {
        e.preventDefault();
        return;
      }
    }
  }

  function onWindowDrop(e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;

    var torrents = Array.prototype.slice.call(files).filter(function (f) {
      return /\.torrent$/i.test(f.name || "");
    });
    if (!torrents.length) return;

    e.preventDefault();
    torrents.forEach(function (file) {
      file.arrayBuffer().then(function (buf) {
        return addTorrentInput({ bytes: new Uint8Array(buf), fileName: file.name }, { source: "drop" });
      }).catch(function (err) {
        toast("No se pudo leer " + file.name + ": " + (err.message || err), "error", 5000);
      });
    });
  }

  function onVisibilityChange() {
    scheduleNextPoll();
  }

  function registerListeners() {
    window.addEventListener("paste", onWindowPaste);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    document.addEventListener("visibilitychange", onVisibilityChange);

    disposers.push(function () {
      window.removeEventListener("paste", onWindowPaste);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });
  }

  // ==========================================================================
  // 19. CICLO DE VIDA
  // ==========================================================================

  async function boot() {
    if (booting) return;
    booting = true;

    try {
      await loadState();

      if (state.migrated) {
        await saveState();
        toast("Biblioteca migrada desde TorrentLy 1.3", "info", 5000);
      }

      state.loaded = true;
      paintIfSafe();

      await resolveEngine(false);
      if (isQbConnected()) {
        await pollOnce();
      }
      scheduleNextPoll();
      await syncSource();
      paintIfSafe();
    } catch (err) {
      console.error("[TorrentLy] Error arrancando:", err);
      state.loaded = true;
      toast("TorrentLy no pudo arrancar: " + (err.message || err), "error", 6000);
      paintIfSafe();
    } finally {
      booting = false;
    }
  }

  function cleanup() {
    disposers.forEach(function (fn) {
      try { fn(); } catch (e) { /* nada */ }
    });
    disposers = [];

    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    closeModal();

    if (activeRoot) {
      activeRoot.classList.remove("trly-root");
      activeRoot.innerHTML = "";
      activeRoot = null;
    }

    api = null;
    state.loaded = false;
    booting = false;
  }

  // ==========================================================================
  // 20. HOOK DE TEST
  // ==========================================================================

  if (typeof window !== "undefined" && window.__INDEXLY_PLUGIN_TEST__) {
    window.__trlyTest = {
      // núcleo
      parseMagnet: parseMagnet,
      buildMagnet: buildMagnet,
      normalizeBtih: normalizeBtih,
      base32ToHex: base32ToHex,
      magnetKey: magnetKey,
      decodeBencode: decodeBencode,
      parseTorrentFile: parseTorrentFile,
      sha1Hex: sha1Hex,
      // formato
      fmtBytes: fmtBytes,
      fmtSpeed: fmtSpeed,
      fmtEta: fmtEta,
      fmtPercent: fmtPercent,
      // motor
      createQbClient: createQbClient,
      normalizeQbUrl: normalizeQbUrl,
      formEncode: formEncode,
      // estado
      migrateV3: migrateV3,
      normalizeEntry: normalizeEntry,
      serializeEntry: serializeEntry,
      buildSourceItems: buildSourceItems,
      addToLibrary: addToLibrary,
      removeFromLibrary: removeFromLibrary,
      findEntry: findEntry,
      findEntryByHash: findEntryByHash,
      setState: function (patch) {
        if (!patch) return;
        if (patch.torrents) state.torrents = patch.torrents.map(normalizeEntry).filter(Boolean);
        if (patch.settings) state.settings = Object.assign({}, state.settings, patch.settings);
        if (patch.sourceId !== undefined) state.sourceId = patch.sourceId;
        if (patch.loaded !== undefined) state.loaded = patch.loaded;
      },
      getState: function () { return state; },
      setEngine: function (patch) { engine = Object.assign({}, engine, patch || {}); },
      getEngine: function () { return engine; },
      setLive: function (map) { live = map || {}; },
      getLive: function () { return live; },
      resolveEngine: resolveEngine,
      addTorrentInput: addTorrentInput,
      syncSource: syncSource,
      renderPage: renderPage,
      cleanup: cleanup,
      setApi: function (a) { api = a; },
    };
  }

  // ==========================================================================
  // 21. REGISTRO
  // ==========================================================================

  IndexLy.plugin({
    id: "torrently",
    activate: function (ctx) {
      api = ctx;
      ensureStyles();

      ctx.addSection({ id: "torrently", label: "TorrentLy", render: renderPage });

      ctx.addCardAction({
        id: "trly-add",
        label: "🧲 Añadir a TorrentLy",
        match: function (item) {
          return !!(item && item.link && /^magnet:\?/i.test(item.link));
        },
        onClick: function (item) {
          return addTorrentInput(item.link, { title: item.title, source: "search" });
        },
      });

      var unsubHydrate = ctx.on("items:hydrate", decorateCard);
      if (typeof unsubHydrate === "function") disposers.push(unsubHydrate);

      var unsubDeleted = ctx.on("source:deleted", function (data) {
        if (data && data.id && data.id === state.sourceId) {
          state.sourceId = null;
        }
      });
      if (typeof unsubDeleted === "function") disposers.push(unsubDeleted);

      registerListeners();

      if (typeof ctx.disposable === "function") {
        ctx.disposable(cleanup);
      }

      boot();
    },
    deactivate: function () {
      cleanup();
    },
  });
})(IndexLy);
