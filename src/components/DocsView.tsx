// src/components/DocsView.tsx — Vista de Documentación Técnica de IndexLy v2.0 integrada como Pestaña
import React, { useState, useMemo } from 'react';
import {
  Search,
  BookOpen,
  Cpu,
  Shield,
  Activity,
  Layers,
  Terminal,
  Monitor,
  Wrench,
  Code,
  Zap,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
  Sliders,
  CheckCircle,
  AlertCircle,
  Database,
  ArrowLeft,
  X,
} from 'lucide-react';

interface DocsViewProps {
  onClose?: () => void;
}

type CopyCodeFn = (code: string, id: string) => void;

interface DocSection {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; className?: string; color?: string }>;
  badge: string;
  tags: string[];
  render: (copyCode: CopyCodeFn, copiedId: string | null) => React.ReactNode;
}

export const DocsView: React.FC<DocsViewProps> = ({ onClose }) => {
  const [activeSectionId, setActiveSectionId] = useState<string>('overview');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 2000);
  };

  const sections: DocSection[] = useMemo(
    () => [
      {
        id: 'overview',
        title: 'Arquitectura & Visión',
        subtitle: 'Tauri v2, Rust backend, React 19 y SQLite FTS5',
        icon: Cpu,
        badge: 'Core Engine',
        tags: ['arquitectura', 'rust', 'tauri', 'sqlite', 'fts5', 'react', 'typescript', 'rendimiento'],
        render: () => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">IndexLy Platform v2.0</span>
              <h2>Arquitectura del Sistema</h2>
              <p className="doc-lead">
                IndexLy Desktop es una plataforma de indexación y búsqueda instantánea local construida con
                un motor de alto rendimiento en Rust, persistencia SQLite FTS5 reactiva y una interfaz moderna en
                React 19 + TypeScript sobre Tauri v2.
              </p>
            </div>

            <div className="doc-callout info">
              <div className="doc-callout-title">
                <CheckCircle size={15} color="#38bdf8" />
                <span>Principios Arquitectónicos Vinculantes</span>
              </div>
              <p>
                La plataforma sigue el <strong>modelo Obsidian</strong>: los plugins se ejecutan en el mismo runtime que la
                aplicación principal, compartiendo el acceso directo al DOM, a la API del host (<code>app.*</code>) y al subsistema nativo
                (<code>app.native</code>), sin barreras artificiales de iframes ni workers.
              </p>
            </div>

            <h3 className="doc-heading">Pila Tecnológica</h3>
            <div className="doc-grid-2">
              <div className="doc-card">
                <h4>🦀 Backend Nativo (Rust + Tauri v2)</h4>
                <p>
                  Motor central de indexación con <code>rusqlite</code> compilado con extensiones FTS5. Triggers SQL reactivos
                  (<code>items_ai</code>, <code>items_au</code>, <code>items_ad</code>) que sincronizan automáticamente las tablas
                  de búsqueda en texto completo. Streaming de resultados en chunks mediante canales IPC Tauri de baja latencia.
                </p>
              </div>
              <div className="doc-card">
                <h4>⚛️ Frontend Reactivo (React 19 + TS)</h4>
                <p>
                  Interfaz ultra-ligera optimizada para respuesta en &lt;16ms (60 FPS), gestión de estado inmutable, renderizado
                  declarativo de hojas (<code>WorkspaceLeaf</code>) y componentes atómicos con Tailwind y CSS modular oscuro.
                </p>
              </div>
            </div>

            <h3 className="doc-heading">10 Reglas de Diseño de la API</h3>
            <ul className="doc-rules-list">
              <li>
                <strong>1. Un solo objeto raíz (<code>app</code>):</strong> Todo el grafo de capacidades cuelga del singleton <code>app</code>.
              </li>
              <li>
                <strong>2. Limpieza reversible LIFO:</strong> Todo lo registrado con <code>this.register*()</code> o <code>this.add*()</code> se destruye automáticamente en <code>onunload()</code>.
              </li>
              <li>
                <strong>3. Ciclo de vida explícito y tipado:</strong> Métodos <code>onload()</code> (timeout 10s) y <code>onunload()</code> (5s) asíncronos y cancelables.
              </li>
              <li>
                <strong>4. API aditiva para siempre:</strong> Nada se elimina ni renombra. El contrato público está congelado en <code>golden-contract.api.md</code>.
              </li>
              <li>
                <strong>5. Aislamiento de fallos (SafeCall):</strong> Ninguna excepción o promesa rechazada de un plugin propaga al host.
              </li>
              <li>
                <strong>6. Tipado de primera clase:</strong> Definición completa <code>indexly.d.ts</code> distribuida con el paquete <code>indexly</code>.
              </li>
              <li>
                <strong>7. Rendimiento predecible:</strong> Búsqueda con streaming paginado (<code>AsyncIterable&lt;SearchHit&gt;</code>) y <code>AbortSignal</code>.
              </li>
              <li>
                <strong>8. Acceso nativo seguro:</strong> Base de datos restringida a consultas con <code>PRAGMA query_only = ON</code> y llavero cifrado.
              </li>
              <li>
                <strong>9. El host manda en el DOM:</strong> Contenedores dedicados por vista para prevenir colisiones de estilo globales.
              </li>
              <li>
                <strong>10. Recuperación automática (Safe Mode):</strong> Detección de fallos en bucle (&gt;3 caídas en 15s) que aísla los plugins inestables.
              </li>
            </ul>
          </div>
        ),
      },
      {
        id: 'trust-model',
        title: 'Modelo de Confianza',
        subtitle: 'Obsidian Trust Model vs Sandboxing tradicional',
        icon: Shield,
        badge: 'Seguridad',
        tags: ['seguridad', 'obsidian', 'trust', 'sandbox', 'permisos', 'safe-mode', 'restringido'],
        render: () => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">Filosofía de Seguridad</span>
              <h2>Obsidian Trust Model</h2>
              <p className="doc-lead">
                IndexLy no finge un sandbox inexistente. Adoptamos con honestidad técnica el modelo probado por herramientas líderes
                como <strong>Obsidian</strong> y <strong>VS Code</strong>: máxima potencia sin degradación de rendimiento.
              </p>
            </div>

            <div className="doc-callout warning">
              <div className="doc-callout-title">
                <AlertCircle size={15} color="#f59e0b" />
                <span>¿Por qué descartamos los iframes y WebWorkers?</span>
              </div>
              <p>
                Los iframes y WebWorkers rompen la ergonomía de desarrollo, introducen latencia de serialización JSON en cada llamada,
                impiden renderizar componentes React compartidos en el árbol DOM y generan una falsa sensación de seguridad que suele
                acabar en fugas de memoria y proxies frágiles.
              </p>
            </div>

            <h3 className="doc-heading">Capas de Protección Real</h3>
            <div className="doc-feature-stack">
              <div className="doc-feature-item">
                <div className="doc-feature-icon">🛡️</div>
                <div className="doc-feature-content">
                  <h4>Modo Restringido Global</h4>
                  <p>
                    Permite apagar inmediatamente el motor de plugins de forma global. Ningún archivo <code>main.js</code> de terceros
                    se ejecuta y la aplicación opera exclusivamente con su núcleo nativo.
                  </p>
                </div>
              </div>
              <div className="doc-feature-item">
                <div className="doc-feature-icon">✅</div>
                <div className="doc-feature-content">
                  <h4>Activación Explícita por Plugin</h4>
                  <p>
                    Ningún plugin recién descargado o detectado en la carpeta de extensiones se ejecuta automáticamente. El usuario debe
                    habilitarlo de forma consciente tras revisar su manifiesto y permisos declarados.
                  </p>
                </div>
              </div>
              <div className="doc-feature-item">
                <div className="doc-feature-icon">🚨</div>
                <div className="doc-feature-content">
                  <h4>Safe Mode Reactivo con Crash Loop Detection</h4>
                  <p>
                    Si un plugin provoca un error fatal durante la carga o la ventana falla más de 3 veces consecutivas en menos de 15 segundos,
                    IndexLy se reinicia automáticamente en <em>Modo Seguro</em>, desactiva el plugin causante y muestra un banner de recuperación.
                  </p>
                </div>
              </div>
              <div className="doc-feature-item">
                <div className="doc-feature-icon">🔍</div>
                <div className="doc-feature-content">
                  <h4>Permisos Informativos y Auditoría en Hub</h4>
                  <p>
                    Los permisos declarados en <code>manifest.json</code> (como <code>native:fs</code>, <code>network:fetch</code>, <code>db:read</code>)
                    son para auditoría transparente del usuario en la UI y revisión de código estática en IndexlyHub.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'lifecycle',
        title: 'Ciclo de Vida & Plugin Base',
        subtitle: 'Clase Plugin, registro LIFO y mitigación de fugas',
        icon: Activity,
        badge: 'Runtime',
        tags: ['plugin', 'onload', 'onunload', 'lifo', 'registro', 'eventos', 'generacion', 'timers'],
        render: (copyCode: CopyCodeFn, copied: string | null) => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">Base Class</span>
              <h2>Ciclo de Vida de un Plugin</h2>
              <p className="doc-lead">
                Todo plugin de IndexLy extiende la clase abstracta <code>Plugin</code>. El host gestiona su inicialización,
                persistencia de datos y destrucción limpia sin fugas de memoria.
              </p>
            </div>

            <div className="doc-code-box">
              <div className="doc-code-header">
                <span>Estructura base de un Plugin (TypeScript)</span>
                <button
                  type="button"
                  className="doc-copy-btn"
                  onClick={() =>
                    copyCode(
                      `import { Plugin, App, PluginManifest } from 'indexly';

export default class MyExtension extends Plugin {
  private count = 0;

  async onload(): Promise<void> {
    console.log('Inicializando', this.manifest.name);

    // Cargar ajustes guardados
    const data = await this.loadData<{ count?: number }>();
    this.count = data?.count ?? 0;

    // Registrar comando en la paleta (se limpiará solo en onunload)
    this.addCommand({
      id: 'increment-counter',
      name: 'Incrementar contador',
      callback: () => {
        this.count++;
        this.saveData({ count: this.count });
        new this.app.ui.Notice(\`Contador actual: \${this.count}\`);
      },
    });

    // Registrar icono en el ribbon
    this.addRibbonIcon('Sparkles', 'Mi Plugin', () => {
      this.app.commands.executeCommand('my-plugin:increment-counter');
    });

    // Registrar timer seguro (se cancelará solo en onunload)
    this.registerInterval(
      window.setInterval(() => {
        console.log('Heartbeat de plugin activo');
      }, 30000)
    );
  }

  async onunload(): Promise<void> {
    console.log('Plugin descargado limpiamente');
  }
}`,
                      'code-lifecycle'
                    )
                  }
                >
                  {copied === 'code-lifecycle' ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                  <span>{copied === 'code-lifecycle' ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <pre>
                <code>{`import { Plugin, App, PluginManifest } from 'indexly';

export default class MyExtension extends Plugin {
  private count = 0;

  async onload(): Promise<void> {
    console.log('Inicializando', this.manifest.name);

    // Cargar ajustes guardados
    const data = await this.loadData<{ count?: number }>();
    this.count = data?.count ?? 0;

    // Registrar comando en la paleta (se limpiará solo en onunload)
    this.addCommand({
      id: 'increment-counter',
      name: 'Incrementar contador',
      callback: () => {
        this.count++;
        this.saveData({ count: this.count });
        new this.app.ui.Notice(\`Contador actual: \${this.count}\`);
      },
    });

    // Registrar icono en el ribbon
    this.addRibbonIcon('Sparkles', 'Mi Plugin', () => {
      this.app.commands.executeCommand('my-plugin:increment-counter');
    });

    // Registrar timer seguro (se cancelará solo en onunload)
    this.registerInterval(
      window.setInterval(() => {
        console.log('Heartbeat de plugin activo');
      }, 30000)
    );
  }

  async onunload(): Promise<void> {
    console.log('Plugin descargado limpiamente');
  }
}`}</code>
              </pre>
            </div>

            <h3 className="doc-heading">Métodos del Ciclo de Vida</h3>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Método</th>
                    <th>Firma</th>
                    <th>Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>onload()</code></td>
                    <td><code>() =&gt; void | Promise&lt;void&gt;</code></td>
                    <td>Invocado al activar el plugin. Timeout 10s. Protegido con SafeCall.</td>
                  </tr>
                  <tr>
                    <td><code>onunload()</code></td>
                    <td><code>() =&gt; void | Promise&lt;void&gt;</code></td>
                    <td>Invocado al desactivar. Timeout 5s. Debe ser idempotente.</td>
                  </tr>
                  <tr>
                    <td><code>loadData&lt;T&gt;()</code></td>
                    <td><code>() =&gt; Promise&lt;T | null&gt;</code></td>
                    <td>Lee el fichero <code>data.json</code> aislado en la carpeta del plugin.</td>
                  </tr>
                  <tr>
                    <td><code>saveData(data)</code></td>
                    <td><code>(data: any) =&gt; Promise&lt;void&gt;</code></td>
                    <td>Persiste datos de configuración del plugin en disco atómicamente.</td>
                  </tr>
                  <tr>
                    <td><code>register(fn)</code></td>
                    <td><code>(fn: () =&gt; void) =&gt; void</code></td>
                    <td>Encola un callback de limpieza para ejecutarse automáticamente en LIFO.</td>
                  </tr>
                  <tr>
                    <td><code>registerDomEvent()</code></td>
                    <td><code>(el, type, cb) =&gt; void</code></td>
                    <td>Añade un event listener al DOM y lo desuscribe automáticamente al descargar.</td>
                  </tr>
                  <tr>
                    <td><code>registerInterval()</code></td>
                    <td><code>(id: number) =&gt; number</code></td>
                    <td>Registra un timer de <code>setInterval</code> para cancelarlo en <code>onunload</code>.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ),
      },
      {
        id: 'api-graph',
        title: 'Grafo de APIs (app.*)',
        subtitle: 'Library, Search, Workspace, Commands, Settings y Storage',
        icon: Layers,
        badge: 'API Surface',
        tags: ['app', 'library', 'search', 'workspace', 'commands', 'settings', 'importer', 'hub', 'events', 'storage'],
        render: (copyCode: CopyCodeFn, copied: string | null) => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">API Reference</span>
              <h2>Grafo de la API Pública</h2>
              <p className="doc-lead">
                El objeto <code>app</code> expone todas las capacidades de la plataforma agrupadas en módulos de dominio coherentes.
              </p>
            </div>

            <div className="doc-card-list">
              <div className="doc-api-module">
                <div className="doc-api-header">
                  <Database size={16} color="#38bdf8" />
                  <h4><code>app.library</code> — Gestión de Fuentes y Contenido</h4>
                  <button
                    type="button"
                    className="doc-copy-btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() =>
                      copyCode(
                        `const sources = await app.library.getSources();\nconst items = await app.library.getItems();`,
                        'code-api-library'
                      )
                    }
                  >
                    {copied === 'code-api-library' ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                    <span>{copied === 'code-api-library' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p>Permite interactuar con las colecciones, fuentes configuradas e ítems indexados.</p>
                <pre className="doc-inline-code">
{`app.library.getSources(): Promise<Source[]>
app.library.getSource(id: string): Promise<Source | null>
app.library.addSource(input: SourceCreateInput): Promise<Source>
app.library.updateSource(id: string, patch: Partial<Source>): Promise<Source>
app.library.removeSource(id: string): Promise<boolean>
app.library.getItems(query?: LibraryItemQuery): Promise<IndexedItem[]>
app.library.on('source:added' | 'source:updated' | 'source:removed' | 'items:changed', cb): EventRef`}
                </pre>
              </div>

              <div className="doc-api-module">
                <div className="doc-api-header">
                  <Search size={16} color="#22c55e" />
                  <h4><code>app.search</code> — Motor FTS5 y Streaming Reactivo</h4>
                  <button
                    type="button"
                    className="doc-copy-btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() =>
                      copyCode(
                        `const controller = new AbortController();\nfor await (const chunk of app.search.queryStream('react', { signal: controller.signal })) {\n  console.log(chunk.hits);\n}`,
                        'code-api-search'
                      )
                    }
                  >
                    {copied === 'code-api-search' ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                    <span>{copied === 'code-api-search' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p>Búsquedas instantáneas de texto completo con soporte de cancelación y resultados en streaming.</p>
                <pre className="doc-inline-code">
{`// Búsqueda directa con promesa
const results = await app.search.query('react tauri', { limit: 20 });

// Búsqueda en streaming con AbortSignal para UIs fluidas
const controller = new AbortController();
for await (const chunk of app.search.queryStream('machine learning', { signal: controller.signal })) {
  console.log('Resultados parciales recibidos:', chunk.hits.length);
}

// Interceptar y decorar resultados antes o después de la búsqueda
app.search.on('query:before', ({ query }) => console.log('Buscando:', query));`}
                </pre>
              </div>

              <div className="doc-api-module">
                <div className="doc-api-header">
                  <Monitor size={16} color="#a855f7" />
                  <h4><code>app.workspace</code> — Ventanas, Vistas y Hojas (Leaves)</h4>
                </div>
                <p>Control del espacio de trabajo visual, registro de vistas personalizadas y Spotlight.</p>
                <pre className="doc-inline-code">
{`app.workspace.registerView('my-custom-view', (leaf) => new MyCustomView(leaf));
app.workspace.openSpotlight(): Promise<void>
app.workspace.getActiveWindow(): WorkspaceWindow
app.workspace.getLeaves(): WorkspaceLeaf[]
app.workspace.onLayoutReady(cb: () => void): void`}
                </pre>
              </div>

              <div className="doc-api-module">
                <div className="doc-api-header">
                  <Terminal size={16} color="#f59e0b" />
                  <h4><code>app.commands</code> — Paleta de Comandos y Atajos</h4>
                </div>
                <p>Añade acciones invocables desde la paleta (<code>Ctrl+K</code>) o mediante atajos de teclado globales.</p>
                <pre className="doc-inline-code">
{`app.commands.addCommand({
  id: 'quick-clean',
  name: 'Limpiar caché de fuentes',
  shortcut: 'Mod+Shift+C',
  callback: () => app.library.reindex(),
});`}
                </pre>
              </div>

              <div className="doc-api-module">
                <div className="doc-api-header">
                  <Sliders size={16} color="#ec4899" />
                  <h4><code>app.storage</code> &amp; <code>app.events</code> — Datos y Bus de Eventos</h4>
                </div>
                <p>Almacenamiento en disco para ficheros del plugin y bus de eventos desacoplado.</p>
                <pre className="doc-inline-code">
{`// Storage en la carpeta aislada del plugin
await app.storage.writeJson('config.json', { theme: 'dark', autoSync: true });
const config = await app.storage.readJson<{ theme: string }>('config.json');

// Bus de eventos tipado con namespace seguro
const ref = app.events.on('my-plugin:sync', (payload) => console.log(payload));
app.events.emit('my-plugin:sync', { timestamp: Date.now() });
app.events.off(ref);`}
                </pre>
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'native',
        title: 'Acceso Nativo (app.native)',
        subtitle: 'fs, path, process, net, SQLite query y keychain',
        icon: Terminal,
        badge: 'Host Bridge',
        tags: ['native', 'fs', 'net', 'sqlite', 'db', 'process', 'keychain', 'clipboard', 'shortcuts'],
        render: (copyCode: CopyCodeFn, copied: string | null) => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">Native Subsystem</span>
              <h2>Acceso al Sistema Operativo</h2>
              <p className="doc-lead">
                <code>app.native</code> canaliza de forma limpia y tipada todas las llamadas IPC hacia Tauri y el backend de Rust,
                garantizando estabilidad y rendimiento nativo.
              </p>
            </div>

            <div className="doc-grid-2">
              <div className="doc-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4>📂 <code>app.native.fs</code> &amp; <code>path</code></h4>
                  <button
                    type="button"
                    className="doc-copy-btn"
                    onClick={() =>
                      copyCode(
                        `const text = await app.native.fs.readTextFile('C:/doc.txt');`,
                        'code-native-fs'
                      )
                    }
                  >
                    {copied === 'code-native-fs' ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                    <span>{copied === 'code-native-fs' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p>Lectura y escritura atómica en el sistema de archivos del usuario sin bloqueos.</p>
                <pre className="doc-inline-code">
{`const text = await app.native.fs.readTextFile('C:/doc.txt');
await app.native.fs.writeTextFile('C:/out.txt', 'Hola');
const p = await app.native.path.join('dir', 'file.csv');`}
                </pre>
              </div>

              <div className="doc-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4>🌐 <code>app.native.net</code> (Fetch sin CORS)</h4>
                  <button
                    type="button"
                    className="doc-copy-btn"
                    onClick={() =>
                      copyCode(
                        `const resp = await app.native.net.fetch('https://api.github.com');`,
                        'code-native-net'
                      )
                    }
                  >
                    {copied === 'code-native-net' ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                    <span>{copied === 'code-native-net' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p>Peticiones HTTP/HTTPS ejecutadas a través del cliente nativo de Rust, sin restricciones CORS de navegador.</p>
                <pre className="doc-inline-code">
{`const resp = await app.native.net.fetch('https://api.github.com/repos/...', {
  headers: { 'User-Agent': 'IndexLy-Plugin' },
});
const data = await resp.json();`}
                </pre>
              </div>

              <div className="doc-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4>🗄️ <code>app.native.db</code> (SQLite Seguro)</h4>
                  <button
                    type="button"
                    className="doc-copy-btn"
                    onClick={() =>
                      copyCode(
                        `const items = await app.native.db.query('SELECT * FROM items LIMIT 10', []);`,
                        'code-native-db'
                      )
                    }
                  >
                    {copied === 'code-native-db' ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                    <span>{copied === 'code-native-db' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p>
                  Consultas SQL directas sobre la base de datos de IndexLy con <code>PRAGMA query_only = ON;</code> reforzado en Rust.
                </p>
                <pre className="doc-inline-code">
{`// Solo lectura garantizada por Rust
const items = await app.native.db.query(
  'SELECT id, title, uri FROM items WHERE file_size_bytes > ? LIMIT 10',
  [1024 * 1024]
);`}
                </pre>
              </div>

              <div className="doc-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4>🔐 <code>app.native.keychain</code> (Llavero Seguro)</h4>
                  <button
                    type="button"
                    className="doc-copy-btn"
                    onClick={() =>
                      copyCode(
                        `await app.native.keychain.setSecret('api_key', 'sec_12345');\nconst key = await app.native.keychain.getSecret('api_key');`,
                        'code-native-keychain'
                      )
                    }
                  >
                    {copied === 'code-native-keychain' ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                    <span>{copied === 'code-native-keychain' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p>Almacena tokens de API y contraseñas de forma segura en la tabla criptográfica aislada del host.</p>
                <pre className="doc-inline-code">
{`await app.native.keychain.setSecret('api_key', 'sec_12345');
const key = await app.native.keychain.getSecret('api_key');
await app.native.keychain.deleteSecret('api_key');`}
                </pre>
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'ui-components',
        title: 'Componentes de UI',
        subtitle: 'Modal, Setting, Notice, Menu, SuggestModal y Vistas',
        icon: Monitor,
        badge: 'UI Kit',
        tags: ['ui', 'modal', 'setting', 'notice', 'menu', 'suggest', 'toast', 'view', 'workspaceleaf'],
        render: (copyCode: CopyCodeFn, copied: string | null) => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">Design System</span>
              <h2>Componentes Visuales Oficiales</h2>
              <p className="doc-lead">
                <code>app.ui</code> provee clases y constructores fluidos para construir interfaces perfectamente integradas con
                el tema visual oscuro y minimalista de IndexLy.
              </p>
            </div>

            <h3 className="doc-heading">1. Notificaciones Rápidas (Notice)</h3>
            <div className="doc-code-box">
              <div className="doc-code-header">
                <span>Ejemplo de Notice (Toasts)</span>
                <button
                  type="button"
                  className="doc-copy-btn"
                  onClick={() =>
                    copyCode(
                      `// Toast informativo por 4 segundos
new app.ui.Notice('Fuente sincronizada correctamente', 4000);

// Notificación de advertencia rápida
new app.ui.Notice('Error al conectar con el servidor', 5000);`,
                      'code-notice'
                    )
                  }
                >
                  {copied === 'code-notice' ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                  <span>{copied === 'code-notice' ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <pre>
                <code>{`// Toast informativo por 4 segundos
new app.ui.Notice('Fuente sincronizada correctamente', 4000);

// Notificación de advertencia rápida
new app.ui.Notice('Error al conectar con el servidor', 5000);`}</code>
              </pre>
            </div>

            <h3 className="doc-heading">2. Panel de Ajustes (PluginSettingTab &amp; Setting)</h3>
            <p>Constructor fluido estilo Obsidian para construir filas de configuración con switches, textos y botones.</p>
            <div className="doc-code-box">
              <div className="doc-code-header">
                <span>Definición de SettingTab</span>
                <button
                  type="button"
                  className="doc-copy-btn"
                  onClick={() =>
                    copyCode(
                      `export class MySettingsTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Sincronización Automática')
      .setDesc('Actualizar los índices al iniciar la aplicación')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Clave API')
      .setDesc('Introduce tu clave para el servicio externo')
      .addText((text) =>
        text
          .setPlaceholder('sk_live_...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (val) => {
            this.plugin.settings.apiKey = val;
            await this.plugin.saveData(this.plugin.settings);
          })
      );
  }
}`,
                      'code-settings'
                    )
                  }
                >
                  {copied === 'code-settings' ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                  <span>{copied === 'code-settings' ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <pre>
                <code>{`export class MySettingsTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Sincronización Automática')
      .setDesc('Actualizar los índices al iniciar la aplicación')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Clave API')
      .setDesc('Introduce tu clave para el servicio externo')
      .addText((text) =>
        text
          .setPlaceholder('sk_live_...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (val) => {
            this.plugin.settings.apiKey = val;
            await this.plugin.saveData(this.plugin.settings);
          })
      );
  }
}`}</code>
              </pre>
            </div>
          </div>
        ),
      },
      {
        id: 'test-kit',
        title: 'Testing Kit Oficial',
        subtitle: '@indexly/plugin-test-kit, mocks y verificación de fugas',
        icon: Wrench,
        badge: 'Quality & DX',
        tags: ['test', 'testing', 'mock', 'harness', 'leaks', 'vitest', 'jest', 'dx'],
        render: (copyCode: CopyCodeFn, copied: string | null) => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">Testing Framework</span>
              <h2>Kit de Pruebas Oficial</h2>
              <p className="doc-lead">
                <code>@indexly/plugin-test-kit</code> proporciona utilidades para probar plugins en entornos headless (Vitest, Jest o Node.js),
                verificando el ciclo de vida y garantizando matemáticamente la <strong>ausencia de fugas de memoria</strong>.
              </p>
            </div>

            <div className="doc-callout success">
              <div className="doc-callout-title">
                <CheckCircle size={15} color="#22c55e" />
                <span>Garantía de Cero Fugas (expectNoLeaks)</span>
              </div>
              <p>
                El harness instrumenta <code>setInterval</code>, <code>addEventListener</code> y las subscripciones al bus de eventos.
                Al llamar a <code>expectNoLeaks(harness)</code>, comprueba que tras <code>onunload()</code> no quede ningún listener,
                temporizador o referencia huérfana en el sistema.
              </p>
            </div>

            <div className="doc-code-box">
              <div className="doc-code-header">
                <span>Test unitario completo con PluginTestHarness (Vitest)</span>
                <button
                  type="button"
                  className="doc-copy-btn"
                  onClick={() =>
                    copyCode(
                      `import { describe, it, expect } from 'vitest';
import { createMockApp, PluginTestHarness, expectNoLeaks } from '@indexly/plugin-test-kit';
import MyPlugin from '../src/main';

describe('MyPlugin Lifecycle & Leaks', () => {
  it('se inicializa, registra comandos y se destruye sin fugas', async () => {
    const app = createMockApp();
    const manifest = {
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      minAppVersion: '1.0.0',
      main: 'main.js',
    };

    const plugin = new MyPlugin(app, manifest);
    const harness = new PluginTestHarness(app, plugin);

    // Cargar plugin
    await harness.load();
    expect(harness.commands.size).toBeGreaterThan(0);

    // Ejecutar un comando registrado
    const cmd = Array.from(harness.commands.values())[0];
    cmd.callback();

    // Descargar plugin
    await harness.unload();

    // Comprobar ausencia de fugas
    expectNoLeaks(harness);
  });
});`,
                      'code-test-kit'
                    )
                  }
                >
                  {copied === 'code-test-kit' ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                  <span>{copied === 'code-test-kit' ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <pre>
                <code>{`import { describe, it, expect } from 'vitest';
import { createMockApp, PluginTestHarness, expectNoLeaks } from '@indexly/plugin-test-kit';
import MyPlugin from '../src/main';

describe('MyPlugin Lifecycle & Leaks', () => {
  it('se inicializa, registra comandos y se destruye sin fugas', async () => {
    const app = createMockApp();
    const manifest = {
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      minAppVersion: '1.0.0',
      main: 'main.js',
    };

    const plugin = new MyPlugin(app, manifest);
    const harness = new PluginTestHarness(app, plugin);

    // Cargar plugin
    await harness.load();
    expect(harness.commands.size).toBeGreaterThan(0);

    // Ejecutar un comando registrado
    const cmd = Array.from(harness.commands.values())[0];
    cmd.callback();

    // Descargar plugin
    await harness.unload();

    // Comprobar ausencia de fugas
    expectNoLeaks(harness);
  });
});`}</code>
              </pre>
            </div>
          </div>
        ),
      },
      {
        id: 'samples',
        title: 'Plugins de Referencia',
        subtitle: 'sample-hello-command, sample-custom-view-react, sample-importer-csv',
        icon: Code,
        badge: 'Ejemplos',
        tags: ['ejemplos', 'samples', 'hello', 'react', 'importer', 'csv', 'view'],
        render: () => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">Sample Plugins</span>
              <h2>3 Plugins Oficiales de Referencia</h2>
              <p className="doc-lead">
                Ubicados en el directorio <code>plugins/</code> del repositorio para aprender patrones reales listos para producción.
              </p>
            </div>

            <div className="doc-sample-card">
              <div className="doc-sample-title">
                <span className="sample-tag">Comandos &amp; Ribbon</span>
                <h4>1. sample-hello-command</h4>
              </div>
              <p>
                Muestra la implementación mínima de un plugin: registro de comando en paleta con atajo <code>Mod+Alt+H</code>,
                notificación con <code>Notice</code>, botón interactivo en el Ribbon lateral y contador en la barra de estado.
              </p>
              <pre className="doc-inline-code">
{`plugins/sample-hello-command/
├── manifest.json
├── main.js
└── README.md`}
              </pre>
            </div>

            <div className="doc-sample-card">
              <div className="doc-sample-title">
                <span className="sample-tag">React 19 &amp; Custom Views</span>
                <h4>2. sample-custom-view-react</h4>
              </div>
              <p>
                Registra una vista personalizada en el workspace mediante <code>registerView('sample-react-view', factory)</code>.
                Utiliza <code>ReactDOM.createRoot</code> para montar componentes React 19 dentro de la hoja <code>WorkspaceLeaf</code>,
                con limpieza automática con <code>root.unmount()</code> al desmontarse.
              </p>
              <pre className="doc-inline-code">
{`plugins/sample-custom-view-react/
├── manifest.json
├── main.js
├── styles.css
└── README.md`}
              </pre>
            </div>

            <div className="doc-sample-card">
              <div className="doc-sample-title">
                <span className="sample-tag">Pipeline de Importación</span>
                <h4>3. sample-importer-csv</h4>
              </div>
              <p>
                Extiende el subsistema de fuentes mediante <code>app.importer.registerImporter()</code>. Registra soporte para archivos
                <code>.csv</code> y <code>.tsv</code>, parsea las columnas delimitadas e indexa automáticamente los registros en SQLite FTS5.
              </p>
              <pre className="doc-inline-code">
{`plugins/sample-importer-csv/
├── manifest.json
├── main.js
└── README.md`}
              </pre>
            </div>
          </div>
        ),
      },
      {
        id: 'devtools',
        title: 'Modo Dev, Safe Mode & Atajos',
        subtitle: 'Hot-reload, diagnóstico de errores y accesos rápidos',
        icon: Zap,
        badge: 'Herramientas',
        tags: ['dev', 'hot-reload', 'shortcuts', 'atajos', 'spotlight', 'safe-mode', 'diagnostico'],
        render: () => (
          <div className="doc-article">
            <div className="doc-hero">
              <span className="doc-pill">Developer Experience</span>
              <h2>Depuración &amp; Productividad</h2>
              <p className="doc-lead">
                Flujos de desarrollo ágil para crear extensiones sin reiniciar la aplicación ni perder el contexto de trabajo.
              </p>
            </div>

            <h3 className="doc-heading">Atajos de Teclado del Sistema</h3>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Atajo</th>
                    <th>Acción</th>
                    <th>Contexto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>Ctrl + K</code> / <code>Cmd + K</code></td>
                    <td>Abrir Paleta de Comandos &amp; Spotlight</td>
                    <td>Global</td>
                  </tr>
                  <tr>
                    <td><code>Ctrl + P</code> / <code>Cmd + P</code></td>
                    <td>Búsqueda rápida en ficheros</td>
                    <td>Global</td>
                  </tr>
                  <tr>
                    <td><code>Esc</code></td>
                    <td>Cerrar modal, vista flotante o volver al buscador</td>
                    <td>Global</td>
                  </tr>
                  <tr>
                    <td><code>Ctrl + Shift + I</code></td>
                    <td>Abrir DevTools de Chromium / WebKit</td>
                    <td>Solo en build dev</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="doc-heading">Hot-Reload en Modo Desarrollador</h3>
            <p>
              En el Gestor de Plugins (icono de Puzzle en la cabecera), cada plugin instalado cuenta con un botón de recarga
              rápida (<strong>🔄 Recargar</strong>). Al presionarlo, el host:
            </p>
            <ol className="doc-steps-list">
              <li>Llama a <code>onunload()</code> con timeout de 5s y destruye todos los recursos LIFO asociados.</li>
              <li>Invalida la caché del módulo CommonJS en memoria.</li>
              <li>Vuelve a leer <code>main.js</code> directamente del disco.</li>
              <li>Instancia de nuevo la clase del plugin con un nuevo token de generación (<code>generationId</code>) y ejecuta <code>onload()</code>.</li>
            </ol>
          </div>
        ),
      },
    ],
    []
  );

  // Filtrado reactivo por término de búsqueda
  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (sec) =>
        sec.title.toLowerCase().includes(q) ||
        sec.subtitle.toLowerCase().includes(q) ||
        sec.badge.toLowerCase().includes(q) ||
        sec.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [sections, searchQuery]);

  const activeSection = sections.find((s) => s.id === activeSectionId) || sections[0];

  return (
    <div className="docs-tab-container" role="region" aria-label="Documentación Técnica">
      {/* Barra superior de la pestaña */}
      <div className="docs-tab-toolbar">
        <div className="docs-toolbar-left">
          <div className="docs-toolbar-badge">
            <BookOpen size={14} color="#38bdf8" />
            <span>Documentación Técnica</span>
          </div>
          <span className="docs-toolbar-sub">IndexLy Platform v2.0 • Obsidian Trust Model</span>
        </div>

        <div className="docs-toolbar-right">
          {onClose && (
            <button
              type="button"
              className="plx-btn plx-btn-sec docs-back-btn"
              onClick={onClose}
              title="Volver a la vista del buscador"
            >
              <ArrowLeft size={13} />
              <span>Volver al Buscador</span>
            </button>
          )}

          <a
            href="https://github.com/daidarzzz/indexly"
            target="_blank"
            rel="noopener noreferrer"
            className="docs-header-link"
            title="Ver repositorio en GitHub"
          >
            <span>GitHub</span>
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Grid principal de la pestaña (Sidebar lateral + Panel de lectura) */}
      <div className="docs-tab-body">
        {/* Sidebar lateral */}
        <aside className="docs-tab-sidebar">
          {/* Buscador de temas */}
          <div className="docs-search-box">
            <div className="docs-search-input-wrap">
              <Search size={13} color="var(--color-text-tertiary)" />
              <input
                type="text"
                placeholder="Filtrar temas, APIs o código..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="docs-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="docs-search-clear"
                  title="Limpiar búsqueda"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Lista de temas */}
          <nav className="docs-tab-nav" aria-label="Índice de documentación">
            {filteredSections.length === 0 ? (
              <div className="docs-empty-search">
                No se encontraron secciones para «{searchQuery}»
              </div>
            ) : (
              filteredSections.map((sec) => {
                const Icon = sec.icon;
                const isActive = sec.id === activeSection.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveSectionId(sec.id)}
                    className={`docs-nav-item ${isActive ? 'active' : ''}`}
                  >
                    <div className="docs-nav-icon">
                      <Icon size={14} color={isActive ? '#38bdf8' : 'var(--color-text-secondary)'} />
                    </div>
                    <div className="docs-nav-text">
                      <span className="docs-nav-title">{sec.title}</span>
                      <span className="docs-nav-sub">{sec.badge}</span>
                    </div>
                    {isActive && <ChevronRight size={13} color="#38bdf8" style={{ marginLeft: 'auto' }} />}
                  </button>
                );
              })
            )}
          </nav>

          {/* Pie de sidebar */}
          <div className="docs-tab-footer">
            <span>RFC-0001 Compliant</span>
            <span className="docs-mono-sub">Native IPC</span>
          </div>
        </aside>

        {/* Panel de lectura */}
        <main className="docs-tab-content">
          {activeSection.render(handleCopyCode, copiedId)}
        </main>
      </div>
    </div>
  );
};
