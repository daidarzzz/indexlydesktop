/**
 * IndexLy — Landing
 * Idioma automático (ES / EN), instalación con copia, detección de sistema,
 * demo animada de la app y apariciones al hacer scroll.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- 1. Textos (ES / EN) ---------------------------------------------------
  var TRANSLATIONS = {
    es: {
      doc_title: 'Indexly — Encuentra cualquier cosa de tu catálogo en segundos',
      doc_desc: 'Buscador universal de catálogos y bibliotecas locales para juegos, multimedia, libros y volcados JSON/CSV. SQLite FTS5 acelerado por Rust. 100% offline.',
      skip: 'Saltar al contenido',
      nav_features: 'Capacidades',
      nav_spotlight: 'Spotlight',
      nav_arch: 'Arquitectura',
      nav_plugins: 'Plugins',
      nav_faq: 'FAQ',
      nav_download: 'Descargar',
      hero_badge: 'v1.2 · Nuevo espacio de trabajo a pantalla completa y Hub de plugins',
      hero_title: 'Encuentra cualquier cosa de tu catálogo <em>en segundos.</em>',
      hero_lede: 'Indexly unifica tus colecciones dispersas, bibliotecas multimedia, listas de juegos y volcados JSON/CSV en un buscador local ultrarrápido. Impulsado por Rust y SQLite FTS5. Sin telemetría y 100% offline.',
      cta_download: 'Descargar gratis',
      cta_download_os: 'Descargar para {os}',
      cta_github: 'Ver en GitHub',
      copy_btn: 'copiar',
      copy_btn_done: '¡copiado!',
      quick_note: 'Disponible para Windows 10/11, macOS Apple Silicon/Intel y Linux x64.',
      features_eyebrow: 'Capacidades',
      features_heading: '¿Qué es Indexly?',
      features_intro: 'Indexly es un motor de búsqueda y catalogación local-first universal. Erradica el tiempo perdido buscando archivos en discos dispersos, carpetas o volcados organizándolo todo en un índice instantáneo sin conexión.',
      f1_title: 'Ingesta Universal de Catálogos',
      f1_desc: 'Reúne bibliotecas de juegos, listas de películas, libros digitales, discografías, volcados CSV y enlaces magnet en un único panel con búsqueda unificada.',
      f2_title: 'Búsqueda Sub-milisegundo (< 0.5 ms)',
      f2_desc: 'Motor nativo en Rust con SQLite FTS5, normalización de diacríticos y ranking de relevancia BM25. Encuentra cualquier ítem entre cientos de miles al instante.',
      spot_eyebrow: 'Spotlight',
      f3_title: 'Atajo Global Spotlight (Alt+Space / Ctrl+K)',
      f3_desc: 'Invoca la barra de búsqueda flotante sobre cualquier juego, navegador o ventana del sistema operativo para copiar enlaces o abrir elementos sin cambiar de contexto.',
      f4_title: 'Auto-Mapeo & Envelopes Flexibles',
      f4_desc: 'Arrastra cualquier archivo JSON, CSV o envelope v2. Indexly detecta automáticamente títulos, enlaces de descarga/magnet y tamaños sin configuración manual.',
      f5_title: 'Indexly Hub & Plugins Estilo Obsidian',
      f5_desc: 'Conecta paquetes de catálogos pre-indexados de Indexly Hub o añade plugins comunitarios (GameVault, ReadLy, vistas en cuadrícula) con @indexly/plugin-api.',
      f6_title: '100% Local-First & Cero Telemetría WAN',
      f6_desc: 'Tus catálogos viven en una base de datos SQLite abierta en tu disco local. Cero bytes transmitidos a servidores externos. Sin cuotas mensuales ni ataduras cloud.',
      arch_eyebrow: 'Arquitectura',
      arch_heading: 'Arquitectura Local-First',
      arch_intro: 'Las bases de datos en la nube imponen latencias de 400ms y cuotas de suscripción para consultar tus propias colecciones. Indexly indexa millones de ítems en tu máquina con Rust para un acceso instantáneo.',
      arch_p1: 'Núcleo nativo con Tauri v2',
      arch_p2: 'Ranking BM25 y normalización de diacríticos',
      arch_p3: 'Un único archivo SQLite abierto y tuyo',
      m_lat_label: 'Velocidad de búsqueda',
      m_wan_label: 'Tráfico WAN saliente',
      m_ram_label: 'Consumo de RAM en reposo',
      m_lic_label: 'Almacenamiento local',
      plugins_eyebrow: 'Ecosistema',
      plugins_heading: 'Plugins & Ecosistema',
      plugins_intro: 'Personaliza cómo navegas y enriqueces tus catálogos. Indexly ofrece una API de plugins modular inspirada en Obsidian y un explorador Hub integrado.',
      p_gv_desc: 'Vista en cuadrícula con carátulas y etiquetas de estado para bibliotecas de juegos de PC, ROMs de emulación y títulos instalados.',
      p_rl_desc: 'Espacio de trabajo dedicado para artículos técnicos, libros en PDF/EPUB y notas con visor de previsualización integrado.',
      p_am_desc: 'Reconocedor inteligente de columnas que mapea encabezados CSV no estándar y campos JSON anidados al esquema unificado al vuelo.',
      p_tb_desc: 'Capa de seguridad nativa en Rust que bloquea balizas de telemetría y rastreadores al obtener carátulas o metadatos externos.',
      faq_heading: 'Preguntas Frecuentes',
      faq_q1: '¿Qué tipo de catálogos puedo indexar en Indexly?',
      faq_a1: 'Cualquier cosa catalogable: colecciones de juegos, películas y series, libros digitales, música, volcados de bases de datos o enlaces magnet y torrents. Puedes importar arrays JSON, hojas CSV o paquetes de envelopes v2 de Indexly.',
      faq_q2: '¿Qué tan rápida es la búsqueda en colecciones grandes?',
      faq_a2: 'Indexly utiliza SQLite Full-Text Search (FTS5) en C++ orquestado con Rust. Incluso con más de 500.000 ítems indexados, las consultas tardan menos de 0.5 milisegundos directamente en memoria y caché local de tu SSD.',
      faq_q3: '¿Indexly sube los datos de mis colecciones a la nube?',
      faq_a3: 'Jamás. Indexly opera 100% offline en tu ordenador. Todos los índices, configuraciones y mapeos de fuentes residen en una base de datos SQLite abierta en tu carpeta de usuario local. Cero paquetes de telemetría.',
      faq_q4: '¿Qué es Indexly Hub?',
      faq_a4: 'Indexly Hub es un explorador integrado en la app de escritorio que te permite descubrir, descargar y sincronizar paquetes de catálogos pre-mapeados mantenidos por la comunidad en un solo clic.',
      dl_heading: 'Descargas',
      dl_intro: 'Binarios oficiales para Indexly Desktop v1.2.0.',
      dl_recommended: 'Recomendado',
      foot_download: 'Descargar',
      foot_faq: 'FAQ',
      foot_license: 'Licencia',
      toast_copied: 'Comando copiado al portapapeles'
    },
    en: {
      doc_title: 'Indexly — Find anything in your catalogs in seconds',
      doc_desc: 'Universal local catalog search engine for games, media libraries, books, dumps, and JSON/CSV collections. Sub-millisecond search with SQLite FTS5 and Rust. 100% offline.',
      skip: 'Skip to content',
      nav_features: 'Features',
      nav_spotlight: 'Spotlight',
      nav_arch: 'Architecture',
      nav_plugins: 'Plugins',
      nav_faq: 'FAQ',
      nav_download: 'Download',
      hero_badge: 'v1.2 · New full-width workspace & plugin Hub',
      hero_title: 'Find anything in your catalogs <em>in seconds.</em>',
      hero_lede: 'Indexly unifies your scattered collections, media libraries, game vaults, and JSON/CSV dumps into a blazing-fast local search engine. Powered by Rust and SQLite FTS5. Zero telemetry. 100% offline.',
      cta_download: 'Download for free',
      cta_download_os: 'Download for {os}',
      cta_github: 'View on GitHub',
      copy_btn: 'copy',
      copy_btn_done: 'copied!',
      quick_note: 'Available for Windows 10/11, macOS Apple Silicon/Intel, and Linux x64.',
      features_eyebrow: 'Features',
      features_heading: 'What is Indexly?',
      features_intro: 'Indexly is a universal catalog search engine and personal indexing vault. It eliminates wasted time hunting across scattered disks, folders, and dumps by organizing everything into an instant offline index.',
      f1_title: 'Universal Catalog Ingestion',
      f1_desc: 'Bring game libraries, movie lists, digital books, music collections, CSV files, and magnet link dumps into a single searchable dashboard.',
      f2_title: 'Sub-millisecond Search (< 0.5 ms)',
      f2_desc: 'Native Rust engine with SQLite FTS5, diacritics removal, and BM25 relevance ranking. Find any item out of hundreds of thousands instantly.',
      spot_eyebrow: 'Spotlight',
      f3_title: 'Global Spotlight Shortcut (Alt+Space / Ctrl+K)',
      f3_desc: 'Summon the floating search bar over any game, browser, or desktop window to copy links or launch items without changing context.',
      f4_title: 'Auto-Mapping & Flexible Envelopes',
      f4_desc: 'Drop any JSON, CSV, or v2 envelope. Indexly automatically identifies title, download URI, and size fields with zero configuration needed.',
      f5_title: 'Indexly Hub & Obsidian-Style Plugins',
      f5_desc: 'Connect pre-built catalog packages from Indexly Hub or install community plugins (GameVault, ReadLy, grid views) via @indexly/plugin-api.',
      f6_title: '100% Local-First & Zero WAN Telemetry',
      f6_desc: 'Your catalogs live in an open SQLite database on your machine. 0 bytes are transmitted to remote servers. No subscriptions, no ads, no cloud lock-in.',
      arch_eyebrow: 'Architecture',
      arch_heading: 'Local-First Architecture',
      arch_intro: 'Cloud databases enforce 400ms network round-trips and recurring fees to access your own collection records. Indexly indexes millions of items locally with Rust for instant access.',
      arch_p1: 'Native core with Tauri v2',
      arch_p2: 'BM25 ranking & diacritics removal',
      arch_p3: 'One open SQLite file you own',
      m_lat_label: 'Search speed',
      m_wan_label: 'Outgoing WAN traffic',
      m_ram_label: 'Idle memory usage',
      m_lic_label: 'Data storage',
      plugins_eyebrow: 'Ecosystem',
      plugins_heading: 'Plugins & Ecosystem',
      plugins_intro: 'Customize how your catalogs are browsed and enriched. Indexly provides a modular plugin API inspired by Obsidian and a built-in Hub for catalog packages.',
      p_gv_desc: 'Rich grid cover view and status tags for PC games, emulation ROMs, and installed titles with local launcher integration.',
      p_rl_desc: 'Dedicated workspace section for cataloged PDF papers, EPUB ebooks, and technical markdown specifications with full text preview.',
      p_am_desc: 'Intelligent column recognizer that binds non-standard CSV headers and nested JSON fields to the UnifiedItem schema instantly.',
      p_tb_desc: 'Built-in privacy proxy in Rust that blocks telemetry beacons and trackers when fetching album covers or metadata thumbnails.',
      faq_heading: 'Frequently Asked Questions',
      faq_q1: 'What kinds of catalogs can I search with Indexly?',
      faq_a1: 'Anything you can catalog: game collections, movies and series, digital books, music discographies, dataset dumps, software releases, or torrent and magnet lists. You can import standard JSON arrays, CSV spreadsheets, or Indexly v2 envelope packages.',
      faq_q2: 'How fast is the search across large collections?',
      faq_a2: 'Indexly uses SQLite Full-Text Search (FTS5) compiled in native C++ and managed through Rust. Even with 500,000+ indexed items, queries return in under 0.5 milliseconds directly from local memory and SSD cache.',
      faq_q3: 'Does Indexly upload my library data to the cloud?',
      faq_a3: 'Never. Indexly operates entirely offline on your computer. All indexes, configurations, and source mappings are saved in an open SQLite database inside your local app data folder. Zero telemetry packets leave your machine.',
      faq_q4: 'What is Indexly Hub?',
      faq_a4: 'Indexly Hub is a decentralized repository explorer integrated into the desktop app that allows you to discover, download, and sync pre-mapped catalog packages curated by the community with one click.',
      dl_heading: 'Downloads',
      dl_intro: 'Official binary releases for Indexly Desktop v1.2.0.',
      dl_recommended: 'Recommended',
      foot_download: 'Download',
      foot_faq: 'FAQ',
      foot_license: 'License',
      toast_copied: 'Command copied to clipboard'
    }
  };

  function detectLanguage() {
    try {
      var param = new URLSearchParams(window.location.search).get('lang');
      if (param === 'es' || param === 'en') return param;
    } catch (_) {}
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < langs.length; i++) {
      var l = String(langs[i] || '').toLowerCase();
      if (l.indexOf('es') === 0) return 'es';
      if (l.indexOf('en') === 0) return 'en';
    }
    return 'en';
  }

  var lang = detectLanguage();
  var dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

  document.documentElement.lang = lang;
  var docTitle = document.getElementById('docTitle');
  if (docTitle && dict.doc_title) docTitle.textContent = dict.doc_title;
  var docDesc = document.getElementById('docDesc');
  if (docDesc && dict.doc_desc) docDesc.setAttribute('content', dict.doc_desc);

  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  // Textos con marcado propio (sólo cadenas de este archivo, nunca del usuario)
  document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-html');
    if (dict[key]) el.innerHTML = dict[key];
  });

  // --- 2. Sistema operativo: comando y descarga recomendados ----------------
  var COMMANDS = {
    winget: 'winget install Indexly.Desktop',
    brew: 'brew install --cask indexly',
    curl: 'curl -fsSL https://get.indexly.app | sh'
  };

  var ua = navigator.userAgent || '';
  var os = /Macintosh|Mac OS X/i.test(ua) ? 'mac' : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'windows';
  var OS_NAME = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
  var OS_CMD = { windows: 'winget', mac: 'brew', linux: 'curl' };

  var tabs = document.querySelectorAll('.install-tab');
  var cmdDisplay = document.getElementById('installCmd');
  var activeCommand = COMMANDS.winget;

  function selectTab(key) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-cmd') === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    activeCommand = COMMANDS[key] || COMMANDS.winget;
    if (cmdDisplay) cmdDisplay.textContent = activeCommand;
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      selectTab(tab.getAttribute('data-cmd'));
    });
  });
  selectTab(OS_CMD[os]);

  // Destacar la descarga del sistema del visitante
  var recommended = document.querySelector('.dl-card[data-os="' + os + '"]');
  if (recommended) recommended.classList.add('is-recommended');

  var heroDlText = document.getElementById('heroDownloadText');
  if (heroDlText && dict.cta_download_os) heroDlText.textContent = dict.cta_download_os.replace('{os}', OS_NAME[os]);

  // --- 3. Copiar comando ----------------------------------------------------
  var toast = document.getElementById('toastNotice');
  var toastTimer = null;
  function showToast(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2000);
  }

  var copyBtn = document.getElementById('copyInstallBtn');
  var copyBtnText = document.getElementById('copyBtnText');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        showToast('Clipboard unavailable');
        return;
      }
      navigator.clipboard.writeText(activeCommand).then(function () {
        copyBtn.classList.add('is-done');
        if (copyBtnText) copyBtnText.textContent = dict.copy_btn_done;
        showToast(dict.toast_copied);
        setTimeout(function () {
          copyBtn.classList.remove('is-done');
          if (copyBtnText) copyBtnText.textContent = dict.copy_btn;
        }, 1800);
      }, function () { showToast('Error'); });
    });
  }

  // --- 4. Cabecera al hacer scroll -----------------------------------------
  var header = document.getElementById('siteHeader');
  function onScroll() {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- 5. Apariciones al hacer scroll --------------------------------------
  var reveals = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el, i) {
      // Escalonado suave entre elementos hermanos
      el.style.transitionDelay = Math.min((i % 4) * 60, 180) + 'ms';
      io.observe(el);
    });
  }

  // --- 6. Demo de la app: se escribe una búsqueda y aparecen resultados ------
  var ITEMS = [
    { t: 'Elden Ring: Shadow of the Erdtree', s: 'Steam Rip · v1.12', src: 'gamepack-1 / pc', size: '62.4 GB', h: 258, sh: 212 },
    { t: 'Baldur’s Gate 3 Deluxe Edition', s: 'GOG · v4.1.1', src: 'gamepack-1 / pc', size: '122 GB', h: 30, sh: 212 },
    { t: 'Hollow Knight', s: 'FitGirl Repack · Multi-ES', src: 'Torrents', size: '5.7 GB', h: 220, sh: 330 },
    { t: 'Blade Runner 2049', s: '2160p · HDR10 · Atmos', src: 'stream-1', size: '58.1 GB', h: 12, sh: 150 },
    { t: 'Disco Elysium The Final Cut', s: 'Steam Rip · v1.0.4', src: 'gamepack-1 / pc', size: '18.9 GB', h: 300, sh: 212 },
    { t: 'Dune: Part Two', s: '1080p · WEB-DL', src: 'stream-1', size: '9.8 GB', h: 40, sh: 150 }
  ];
  var QUERIES = ['ring', 'blade', 'dune', 'hollow'];

  var list = document.getElementById('mockList');
  var typed = document.getElementById('typedQuery');
  var countEl = document.getElementById('mockCount');
  var msEl = document.getElementById('mockMs');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(text, q) {
    var safe = esc(text);
    if (!q) return safe;
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return safe.replace(re, '<mark>$1</mark>');
  }

  var lastSig = '';

  function renderRows(q) {
    if (!list) return;
    var matches = q
      ? ITEMS.filter(function (it) { return (it.t + ' ' + it.s).toLowerCase().indexOf(q.toLowerCase()) >= 0; })
      : ITEMS;
    var rows = (matches.length ? matches : ITEMS).slice(0, 6);
    // Completar con el resto para que la lista no quede vacía
    if (rows.length < 6) {
      ITEMS.forEach(function (it) { if (rows.length < 6 && rows.indexOf(it) < 0) rows.push(it); });
    }
    // Mismas filas que antes: sólo se actualiza el resaltado (sin re-animar)
    var sig = rows.map(function (it) { return it.t; }).join('|');
    if (sig === lastSig) {
      list.querySelectorAll('.row').forEach(function (row, i) {
        var b = row.querySelector('.row-main b');
        if (b) b.innerHTML = highlight(rows[i].t, q);
        row.classList.toggle('is-hot', i === 0 && !!q);
      });
      if (countEl) countEl.textContent = q ? String(matches.length || 1) : '23.615';
      return;
    }
    lastSig = sig;

    var head = list.querySelector('.row-head');
    list.innerHTML = '';
    if (head) list.appendChild(head);
    rows.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'row' + (i === 0 && q ? ' is-hot' : '');
      row.style.animationDelay = i * 40 + 'ms';
      row.innerHTML =
        '<span class="row-av" style="background:linear-gradient(135deg,hsl(' + it.h + ',70%,32%),hsl(' + (it.h + 40) + ',80%,18%))">' + esc(it.t.charAt(0)) + '</span>' +
        '<span class="row-main"><b>' + highlight(it.t, q) + '</b><small>' + esc(it.s) + '</small></span>' +
        '<span class="row-src"><i style="background:hsl(' + it.sh + ',70%,58%)"></i>' + esc(it.src) + '</span>' +
        '<span class="row-size">' + esc(it.size) + '</span>' +
        '<span class="row-open">' + (lang === 'es' ? 'Abrir' : 'Open') + ' ↗</span>';
      list.appendChild(row);
    });
    if (countEl) countEl.textContent = q ? String(matches.length || 1) : '23.615';
    if (msEl) msEl.textContent = (0.2 + Math.random() * 0.3).toFixed(2) + ' ms · Rust FTS5';
  }

  renderRows('');

  if (typed && !reduceMotion) {
    var qi = 0;
    var typeQuery = function () {
      var q = QUERIES[qi % QUERIES.length];
      var i = 0;
      typed.textContent = '';
      var typer = setInterval(function () {
        i++;
        typed.textContent = q.slice(0, i);
        renderRows(q.slice(0, i));
        if (i >= q.length) {
          clearInterval(typer);
          setTimeout(function () {
            // Borrar y pasar a la siguiente búsqueda
            var j = q.length;
            var eraser = setInterval(function () {
              j--;
              typed.textContent = q.slice(0, j);
              if (j <= 0) {
                clearInterval(eraser);
                renderRows('');
                qi++;
                setTimeout(typeQuery, 700);
              }
            }, 45);
          }, 2200);
        }
      }, 120);
    };
    setTimeout(typeQuery, 900);
  } else if (typed) {
    typed.textContent = 'ring';
    renderRows('ring');
  }
})();
