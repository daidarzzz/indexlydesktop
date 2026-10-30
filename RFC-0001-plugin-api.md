# RFC-0001: Arquitectura de la API de Plugins de IndexLy Desktop (v1)

- **Estado:** Propuesta Aprobada en Estructura (Fase 0 — Parche Documental P0/P1)
- **Fecha:** 2026-10-30
- **Autores:** Equipo Senior de Plataforma (Obsidian/VS Code/Raycast), DX, Calidad, TypeScript/React y Rust/Tauri
- **Feature Flag:** `plugin_api_v1`
- **Rama:** `feat/plugin-api-v1`
- **Versión de API Host:** `1.0.0`

---

## 1. Resumen Ejecutivo y Contexto

IndexLy Desktop es una aplicación de alto rendimiento para catalogación, búsqueda instantánea (SQLite FTS5) e indexación universal desarrollada con Tauri v2 y React 19. Su motor de extensibilidad previo ("Co-Kernel v3", centrado en `PluginRegistry.ts` y el global `window.IndexLy`) permitió una rápida experimentación pero carece de un contrato formal de estabilidad, aislamiento de fallos, gestión determinista del ciclo de vida y tipado canónico exportable.

Este RFC define la especificación definitiva para la **API de Plugins v1**, adoptando formalmente el **Modelo Obsidian**. La API establece un contrato permanente, tipado de primera clase sin dependencias ambiguas, ciclo de vida con limpieza garantizada (teardown libre de fugas de memoria verificado mediante harness instrumentado), superficie nativa (`app.native`) gobernada mediante comandos Tauri tipados bajo namespace público, taxonomía formal de errores, grandfathering de extensiones previas y resolución vinculante de los 12 puntos de deuda técnica del motor base.

---

## 2. Modelo de Confianza (Trust Model)

### 2.1 Filosofía Obsidian vs Sandbox Ilusorio
En herramientas de productividad y gestión de conocimiento local avanzadas (Obsidian, VS Code, Raycast), los usuarios y desarrolladores requieren acceso fluido y de alto rendimiento al sistema de archivos local, bases de datos SQLite nativas, procesos del sistema operativo e interactividad con el DOM del motor web.

**Decisión vinculante:**
1. **Mismo runtime:** Los plugins se ejecutan directamente en el contexto V8/WebView2 de la aplicación principal. Se descartan explícitamente iframes, Web Workers aislados o subprocesos separados para alojar el código UI del plugin.
2. **Acceso irrestricto en runtime:** El plugin posee acceso total al grafo `app.*`, a comandos nativos mediante `app.native` y al DOM dentro de su contenedor designado.
3. **Rechazo a sandboxes cosméticos:** No se implementan sistemas de permisos restrictivos a nivel de código que simulen contener al plugin mientras comparten el mismo contexto de memoria. Fingir seguridad técnica genera una falsa sensación de protección y penaliza severamente el rendimiento y la flexibilidad.
4. **Aislamiento por Referencias Internas del Host (Sin `Object.freeze`):** Se descarta el uso de `Object.freeze` por su fragilidad en V8, impacto en optimizaciones monomórficas y desalineación con patrones legítimos. El host se protege manteniendo todo su estado interno (registros de comandos, fuentes, hojas, listeners) en `Map`/`Set` privados inaccesibles desde el scope del plugin. Aunque un plugin mutara o reasignara propiedades en su instancia inyectada de `app`, el kernel del host invoca sus métodos y despacha eventos a través de sus propias referencias internas no mutables.

### 2.2 Rol de los Permisos del Manifiesto y Resolución de `db:write`
El campo `permissions` en `manifest.json` (`fs:read`, `net:http`, `process:spawn`, `db:write`, etc.) opera como un **contrato informativo y de transparencia**:
- Durante la instalación o actualización desde el Hub o paquete local, la UI presenta al usuario un desglose detallado de los permisos declarados.
- Si una actualización introduce permisos adicionales, el host suspende la auto-actualización y solicita consentimiento explícito al usuario.
- **Resolución de `db:write`:** Coherente con el principio de no simular sandbox, `app.native.db.exec(sql)` **no se bloquea en tiempo de ejecución**. Sin embargo:
  - `app.native.db.query` utiliza un pool de conexiones SQLite dedicado configurado en **solo lectura** (`PRAGMA query_only = ON`), garantizando que consultas analíticas pesadas de plugins no bloqueen transacciones de escritura del host.
  - `app.native.db.exec` utiliza la conexión de mutación. El manifiesto debe declarar `permissions: ["db:write"]` para que la UI advierta explícitamente al usuario durante la instalación. Los plugins que usen `exec` sin declararlo son marcados en el escáner del Hub como anomalía de auditoría.

### 2.3 Seguridad Social, Revisión y Modo Restringido
- **Activación Explícita (Opt-In):** Ningún plugin recién instalado se activa automáticamente; requiere acción voluntaria del usuario.
- **Modo Restringido (Restricted Mode):** Estado de arranque seguro global en el que ningún plugin de terceros es ejecutado. Ideal para depuración y recuperación de fallos.
- **Protección contra Bloqueos de Arranque (Crash Recovery):** Si IndexLy detecta 2 cierres anormales o cuelgues consecutivos en el arranque, se inicia automáticamente en Modo Restringido, notificando la anomalía y ofreciendo reactivar extensiones de forma individual.
- **Escaneo Preventivo:** El Hub ejecuta análisis estático de dependencias (AST parsing) para detectar patrones maliciosos evidentes (ofuscación extrema, llamadas dinámicas a endpoints sospechosos, manipulación indebida de credenciales).

---

## 3. Grafo de la API Pública v1

Toda la superficie de interacción del host se organiza bajo el paquete npm canónico `@indexly/plugin-api` (distribuido como `indexly`).

```mermaid
graph TD
    App["app: App (Host Root)"] --> Library["app.library (Fuentes & Items)"]
    App --> Search["app.search (FTS5 & Streaming)"]
    App --> Workspace["app.workspace (Hojas, Vistas, Ribbon)"]
    App --> Commands["app.commands (Paleta & Atajos)"]
    App --> Settings["app.settings (Ajustes de Host & Plugins)"]
    App --> Importer["app.importer (Pipelines de Importación)"]
    App --> Hub["app.hub (Gestión de Extensiones)"]
    App --> Native["app.native (Namespace Público Tauri)"]
    App --> Events["app.events (Bus de Eventos Namespaced)"]
    App --> Storage["app.storage (Almacenamiento Aislado en Disco)"]
    App --> UI["app.ui (Modales, Settings, Contenedores)"]
    App --> Legacy["app.legacy (Adaptador retrocompatible v1-v3)"]
```

### 3.1 Interfaz Central `App`
```ts
export interface App {
  readonly version: string;          // p. ej. "0.1.0"
  readonly apiVersion: string;       // "1.0.0"
  readonly features: FeatureSet;     // Detección de capacidades en tiempo de ejecución
  readonly library: LibraryApi;      // Fuentes, colecciones e items
  readonly search: SearchApi;        // Búsqueda local FTS5, streaming y proveedores
  readonly workspace: WorkspaceApi;  // Ventanas, vistas, ribbon, barra de estado
  readonly commands: CommandsApi;    // Comandos de paleta, menú contextual
  readonly settings: SettingsApi;    // Registro de pestañas de configuración y persistencia
  readonly importer: ImporterApi;    // Extensiones del motor de importación
  readonly hub: HubApi;              // Catálogo, instalación y actualización de plugins
  readonly native: NativeApi;        // Puente de capacidades nativas públicas del SO
  readonly events: EventsApi;        // Bus de eventos tipados desacoplado
  readonly storage: StorageApi;      // Persistencia local atómica por plugin
  readonly ui: UiApi;                // Primitivas de interfaz (Modal, Setting, Notice)
  readonly legacy: LegacyApi;        // window.IndexLy retrocompatible (deprecado)
}
```

### 3.2 Clase Base `Plugin` y Jerarquía de Componentes
Los plugins heredan de la clase base `Plugin`. Todas las suscripciones, comandos, vistas y elementos DOM registrados a través de métodos helper quedan enlazados a la instancia mediante un **Token de Generación** (`generationId`) y se desregistran de forma automática e inversa (LIFO) en `onunload()`:

```ts
export abstract class Plugin extends Component {
  public readonly app: App;
  public readonly manifest: PluginManifest;

  constructor(app: App, manifest: PluginManifest);

  // Ciclo de vida principal
  abstract onload(): void | Promise<void>;
  onunload(): void | Promise<void>;

  // Registro declarativo reversible
  addCommand(cmd: Command): Command;
  addRibbonIcon(icon: string, title: string, callback: (ev: MouseEvent) => unknown): HTMLElement;
  addStatusBarItem(): HTMLElement;
  addSettingTab(tab: PluginSettingTab): void;
  registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void;
  registerEvent(ref: EventRef): void;
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    element: HTMLElement | Window | Document,
    type: K,
    callback: (ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  registerInterval(id: number): number;
  register(teardownCallback: () => unknown): void;

  // Persistencia de configuración
  loadData<T = unknown>(): Promise<T | null>;
  saveData(data: unknown): Promise<void>;
}
```

### 3.3 Módulos de Dominio Tipados

- **`app.library`**: `getSources(): Promise<Source[]>`, `getSource(id: string): Promise<Source | null>`, `addSource(input: AddSourceInput): Promise<Source>`, `updateSource(id: string, patch: Partial<Source>): Promise<Source>`, `removeSource(id: string): Promise<void>`, `getItems(query: LibraryQuery): Promise<UnifiedItem[]>`, `getItem(id: string): Promise<UnifiedItem | null>`, `on(event: 'source:added' | 'source:updated' | 'source:removed' | 'items:changed', cb: (payload: unknown) => void): EventRef`.
- **`app.search`**: `query(q: string, opts?: SearchOptions): Promise<SearchResults>`, `queryStream(q: string, opts?: SearchOptions): AsyncIterable<SearchHit>`, `registerProvider(provider: SearchProvider): void`, `unregisterProvider(id: string): void`, `reindex(sourceId?: string): Promise<void>`, `on(event: 'query:before' | 'query:after', cb: (ctx: SearchContext) => void): EventRef`.
- **`app.workspace`**: `getActiveWindow(): WindowInfo`, `getWindows(): WindowInfo[]`, `getLeaves(): WorkspaceLeaf[]`, `getLeaf(type?: string): WorkspaceLeaf`, `revealLeaf(leaf: WorkspaceLeaf): void`, `detachLeavesOfType(type: string): void`, `onLayoutReady(callback: () => void): void`, `openSpotlight(): Promise<void>`, `on(event: 'layout-change' | 'window:open' | 'window:close', cb: (data: unknown) => void): EventRef`.
- **`app.commands`**: `addCommand(command: Command): Command`, `removeCommand(id: string): void`, `executeCommand(id: string, ...args: unknown[]): Promise<boolean>`, `listCommands(): Command[]`, `addContextMenuItem(item: ContextMenuItem): EventRef`.
- **`app.settings`**: `registerSection(section: SettingSection): void`, `registerTab(tab: PluginSettingTab): void`, `get<T = unknown>(key: string, defaultValue?: T): Promise<T>`, `set(key: string, value: unknown): Promise<void>`, `onChange(keyOrCb: string | ((key: string, val: unknown) => void), cb?: (val: unknown) => void): EventRef`.
- **`app.importer`**: `registerImporter(importer: CustomImporter): EventRef`, `importFile(pathOrContent: string, opts?: ImportOptions): Promise<Source[]>`, `on(event: 'import:progress', cb: (p: ImportProgress) => void): EventRef`.
- **`app.hub`**: `search(query: string): Promise<HubPluginSummary[]>`, `getPlugin(id: string): Promise<HubPluginDetail | null>`, `install(id: string, version?: string): Promise<void>`, `update(id: string): Promise<void>`, `uninstall(id: string): Promise<void>`, `listInstalled(): LoadedPluginInfo[]`.
- **`app.events`**: `on(event: string, callback: (data: unknown) => void): EventRef`, `off(ref: EventRef): void`, `emit(event: string, payload?: unknown): void`.
- **`app.storage`**: `pluginDataDir(id: string): Promise<string>`, `readJson<T = unknown>(filename: string): Promise<T | null>`, `writeJson(filename: string, data: unknown): Promise<void>`, `readText(filename: string): Promise<string>`, `writeText(filename: string, content: string): Promise<void>`, `remove(filename: string): Promise<void>`.
- **`app.ui`**: `Modal`, `PluginSettingTab`, `Setting`, `Notice`, `Menu`, `SuggestModal`, `FuzzySuggestModal`, `ItemView`, `getTheme()`, `onThemeChange(cb: (t: string) => void): EventRef`.
- **`app.legacy`**: Fachada que mantiene `window.IndexLy` para compatibilidad de plugins v1–v3.

---

## 4. Superficie Nativa Pública (`app.native`)

### 4.1 Namespace Público y Restricción de `invoke`
Para preservar el contrato de estabilidad y evitar acoplamiento con comandos internos volátiles del host:
1. `app.native.invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>` está restringido a comandos bajo el prefijo canónico de plugins `plugin:*` (p. ej., `plugin:fs_read`, `plugin:process_spawn`) o extensiones registradas en Rust.
2. Si un plugin invoca un comando interno del host (`core:*`, `__host_private_*`), la llamada es rechazada con un `NativeError(ERR_INVOKE_DISALLOWED)`.

### 4.2 Métodos de `NativeApi`
- **`fs`**: `read(path: string): Promise<Uint8Array>`, `readText(path: string): Promise<string>`, `write(path: string, data: Uint8Array | string): Promise<void>`, `readDir(path: string): Promise<DirEntry[]>`, `mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>`, `remove(path: string, opts?: { recursive?: boolean }): Promise<void>`, `rename(from: string, to: string): Promise<void>`, `stat(path: string): Promise<FileStat>`, `watch(path: string, cb: (ev: WatchEvent) => void): Promise<() => void>`.
- **`path`**: `join(...parts: string[]): string`, `resolve(...parts: string[]): string`, `dirname(p: string): string`, `basename(p: string): string`, `extname(p: string): string`, `appData(): Promise<string>`, `appConfig(): Promise<string>`, `home(): Promise<string>`, `temp(): Promise<string>`, `sep: string`.
- **`process`**: `spawn(cmd: string, args?: string[], opts?: SpawnOptions): Promise<ChildHandle>`, `exec(cmd: string, opts?: ExecOptions): Promise<{ code: number; stdout: string; stderr: string }>`, `kill(pid: number): Promise<void>`, `env(): Promise<Record<string, string>>`, `cwd(): Promise<string>`.
- **`net`**: `fetch(input: string | Request, init?: RequestInit): Promise<Response>`, `download(url: string, dest: string, onProgress?: (n: number) => void): Promise<void>`, `listen(port: number, cb: (req: unknown) => void): Promise<() => void>`.
- **`shell`**: `openPath(p: string): Promise<void>`, `openUrl(u: string): Promise<void>`, `showInFolder(p: string): Promise<void>`.
- **`clipboard`**: `readText(): Promise<string>`, `writeText(s: string): Promise<void>`, `readImage(): Promise<Uint8Array | null>`, `writeImage(b: Uint8Array): Promise<void>`.
- **`notifications`**: `send(opts: { title: string; body?: string; icon?: string }): Promise<void>`.
- **`tray`**: `create(opts: TrayOptions): Promise<TrayHandle>`, `update(h: TrayHandle, opts: Partial<TrayOptions>): Promise<void>`, `remove(h: TrayHandle): Promise<void>`.
- **`shortcuts`**: `register(accel: string, cb: () => void): Promise<() => void>`, `unregister(accel: string): Promise<void>`.
- **`windows`**: `create(opts: WindowOptions): Promise<WindowHandle>`, `list(): Promise<WindowInfo[]>`, `focus(id: string): Promise<void>`, `close(id: string): Promise<void>`.
- **`os`**: `platform(): 'windows' | 'macos' | 'linux'`, `arch(): string`, `version(): Promise<string>`, `locale(): string`.
- **`keychain`**: `get(key: string): Promise<string | null>`, `set(key: string, value: string): Promise<void>`, `delete(key: string): Promise<void>`.
- **`db`**: `query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>`, `exec(sql: string): Promise<void>`.

---

## 5. Ciclo de Vida, Semántica de Timeouts y Token de Generación

### 5.1 Semántica Realista de Timeouts (Límites de V8)
En un único hilo de ejecución JavaScript, **ningún timer puede interrumpir código síncrono bloqueante** (`while(true)`). 
Por tanto, la semántica de timeouts se define formalmente:
1. **Código Síncrono:** Se monitoriza mediante `performance.now()`. Si una fase síncrona supera los 250 ms, se registra advertencia de bloqueo. Si el hilo queda completamente bloqueado, el watchdog externo del host alerta tras 10s y el modo seguro actuará en el siguiente arranque.
2. **Promesas Asíncronas (Carga y Descarga):**
   - Si la promesa devuelta por `onload()` no resuelve en **10 segundos**, el host abandona la espera, rechaza la operación, marca el plugin como `Failed` y activa la purga.
   - Si la promesa de `onunload()` no resuelve en **5 segundos**, el host fuerza el descarte inmediato de todos los registros del plugin.
3. **Token de Generación (`generationId`):**
   - Cada ciclo de activación del plugin genera un número entero monótonamente creciente (`generationId: 1, 2, 3...`).
   - Todos los métodos de registro (`addCommand`, `registerView`, `registerEvent`, etc.) verifican que el `generationId` de la llamada coincida con el `generationId` activo en el host.
   - Si una promesa tardía de un `onload()` que sufrió timeout intenta registrar algo a los 12 segundos, el host detecta que su `generationId` ya fue invalidado y **descarta la llamada en silencio**, impidiendo que plugins zombis muten el estado del host.

### 5.2 Atribución de Errores Globales
Para identificar inequívocamente qué plugin causa un error en el entorno global:
1. **Virtual Source URLs:** Todo código evaluado por el loader se carga con la directiva `//# sourceURL=indexly-plugin://${manifest.id}/main.js`.
2. **Stack Trace Parsing:** Los listeners globales `window.onerror` y `window.onunhandledrejection` parsean la traza de pila (stack trace). Si contiene `indexly-plugin://${id}/`, el error se atribuye automáticamente al plugin respectivo.
3. **Execution Context Stack (`safeCall`):** Durante la ejecución de cualquier callback o evento de plugin, el host mantiene una variable de contexto `activePluginContext = pluginId`. Los callbacks diferidos capturan este contexto en su closure.

### 5.3 Test de Fugas con Instrumentación de Harness
El test de 100 ciclos de montaje/desmontaje se ejecuta con el harness `@indexly/plugin-test-kit` mediante instrumentación completa:
1. **EventTarget Spying:** Intercepta `addEventListener` / `removeEventListener` registrando listeners vivos en un `Map<target, Set<{ type, listener, pluginId }>>`.
2. **Timer Interception:** Rastrea cada `setInterval`, `clearInterval`, `setTimeout`, `requestAnimationFrame`.
3. **IPC Subscription Tracking:** Monitorea las llamadas a Tauri `listen` y comprueba que sus `unlisten` se hayan ejecutado.
4. **DOM Tree Diffing & MutationObserver:** Verifica que no queden elementos huérfanos ni hojas de estilo (`<style data-plugin-id>`).
5. **Detección de Retención de Instancia:** Emplea `WeakRef` y `FinalizationRegistry` para comprobar que la instancia del plugin es liberada por el Garbage Collector tras `onunload()`.

---

## 6. Runtime de Plugins (`PluginHost`)

- **Bundle Format (Decisión P1):** Formato CommonJS (CJS) con `main.js`, `manifest.json`, `styles.css` opcional y `data.json`.
- **Cargador CJS:**
  ```ts
  const moduleFn = new Function('module', 'exports', 'require', code);
  ```
- **Allowlist estricto de `require`:** Solo resuelve `'indexly'` (que entrega `app` y clases base) y utilidades puras (`'path'`, `'os'`). Cualquier otra dependencia externa debe compilarse dentro del bundle del plugin.
- **Formato de Export (Decisión P1):** El loader acepta indistintamente `module.exports = PluginClass` o `module.exports.default = PluginClass`.
- **Manejo de React (Decisión P1):** El host provee contenedores `HTMLElement` limpios. Los plugins que utilicen React empaquetan su propio runtime (o usan JSX compilado) y ejecutan `createRoot(container)`. El host no inyecta un React global que cause conflictos de versión.
- **Aislamiento de Fallos y Safe Execution:** Todo callback se envuelve con `safeCall`. Tras 10 errores en 5 minutos, el host suspende preventivamente el plugin y ofrece desactivarlo.

---

## 7. Manifiesto y Hub

### 7.1 Esquema con Integridad Criptográfica
```json
{
  "$schema": "https://indexly.app/schemas/v1/plugin-manifest.json",
  "schemaVersion": 1,
  "id": "com.autor.plugin",
  "name": "Nombre",
  "version": "1.2.3",
  "minHostVersion": "0.1.0",
  "description": "...",
  "author": "...",
  "license": "MIT",
  "isDesktopOnly": true,
  "main": "main.js",
  "styles": "styles.css",
  "permissions": ["fs:read", "net:http"],
  "hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "signature": "ed25519:abcdef123456...",
  "sourceCommit": "0d6e7cf45a1b2c3d4e5f",
  "contributes": { "commands": [], "views": [], "settings": [] }
}
```

- **`hash`:** Hash SHA-256 del archivo `main.js` para verificar integridad tras la descarga.
- **`signature`:** Firma criptográfica Ed25519 del desarrollador o del Hub (informativa).
- **`sourceCommit`:** Hash de commit del repositorio Git de origen para facilitar auditorías de código abierto.

### 7.2 Grandfathering de Manifiestos Legacy
El host incorpora un normalizador automático para extensiones v1–v3 existentes:
1. Si un plugin carece de `schemaVersion`, se le asigna `schemaVersion: 0`.
2. Si el manifiesto declara `capabilities` en lugar de `permissions`, se mapea automáticamente.
3. Si carece de `minHostVersion`, se asume `"0.1.0"`.
4. Si el plugin es un archivo `.js` suelto con cabecera `/* IndexLy Plugin ... */`, se parsea y sintetiza un manifiesto v1 compatible en memoria.

---

## 8. Plan de Migración y Resolución de las 12 Deudas Técnicas

Durante la migración de `PluginRegistry.ts` a `PluginHost` + `PluginApi` se resuelven de forma vinculante los **12 bugs y limitaciones del motor base**:

| # | Deuda Técnica Existente | Solución en la API v1 |
|---|-------------------------|-----------------------|
| 1 | Debounce de búsqueda de 25 ms sin cancelación de peticiones | Debounce configurable con cancelación cooperativa vía `AbortController` y token de solicitud en vuelo. |
| 2 | `ORDER BY file_size` textual en SQLite | Introducción de columna `file_size_bytes INTEGER` indexada; texto conservado para presentación. |
| 3 | Sanitizador FTS5 rudimentario | Tokenizador formal para FTS5 que respeta comillas, comodines y caracteres de puntuación sin syntax errors. |
| 4 | `addSource` ignoraba claves camelCase | Añadido `#[serde(rename_all = "camelCase")]` y alias en `MappingConfig` (`models.rs`). |
| 5 | `insert_sources_batch` omitía `flags_json` | Inclusión explícita de `flags_json` en la consulta batch en `db.rs`. |
| 6 | Mapping CSV no aplicado en normalizador | Paso de `Option<&MappingConfig>` a `parse_csv_to_items` e indexación de columnas dinámicas. |
| 7 | Importación tabular `{k, v}` producía 0 items fuera de v2 envelope | Detección automática del patrón tabular en `normalize_json_to_items` para JSONs estándar. |
| 8 | `.torrent` generaba enlaces magnet sintéticos | Extracción e indexación real del info_hash SHA-1 y metadatos bencoded. |
| 9 | Guard `dataset.rendered` en `Slot.tsx` impedía re-renders | Gestión limpia de ciclo de vida con `useEffect` y referencias de desmontaje. |
| 10 | Vistas custom limpiaban el DOM en cada render | Contenedor gestionado por el plugin; el host no vacía `innerHTML` innecesariamente. |
| 11 | Ventana Spotlight sin capacidades en `default.json` | Declaración de la ventana `"spotlight"` en `src-tauri/capabilities/default.json`. |
| 12 | `ensure_bundled_plugins` con ruta hardcodeada de desarrollo | Detección canónica de recursos con `app_handle.path().resource_dir()`. |

---

## 9. Taxonomía Formal de Errores

Todos los fallos originados en el sistema de plugins extienden de `IndexlyError`:

```ts
export class IndexlyError extends Error {
  public readonly code: string;
  public readonly pluginId?: string;
  public readonly cause?: unknown;
  constructor(message: string, code: string, pluginId?: string, cause?: unknown);
}

export class PluginLifecycleError extends IndexlyError {} // ERR_PLUGIN_LOAD_FAILED, ERR_PLUGIN_UNLOAD_FAILED
export class PluginTimeoutError extends IndexlyError {}   // ERR_PLUGIN_TIMEOUT
export class NativeError extends IndexlyError {}          // ERR_INVOKE_DISALLOWED, ERR_NATIVE_IO, ERR_PROCESS_FAILED
export class StorageError extends IndexlyError {}         // ERR_STORAGE_WRITE, ERR_STORAGE_QUOTA
export class ValidationError extends IndexlyError {}      // ERR_MANIFEST_INVALID, ERR_SCHEMA_MISMATCH
```

---

## 10. Fases del Proyecto

- **Fase 0 — Diseño (sin código):** RFC, design rules, specs de API, manifiesto, taxonomía de errores, plan de migración y riesgos. Parada y aprobación.
- **Fase 1 — Núcleo:** `PluginHost`, cargador CJS, lifecycle LIFO, `generationId`, `register*`, `app.events`, `app.storage`, `app.commands`, aislamiento de errores (`safeCall`), modo seguro, atribución de errores, feature flag `plugin_api_v1`. Tests de fugas con harness.
- **Fase 2 — API de Dominio:** `app.library`, `app.search` (con streaming y cancelación), `app.workspace`, `app.importer`, `app.settings`, `app.ui` (Modal, Setting, Notice, Menu). Adaptador `app.legacy`.
- **Fase 3 — Nativo:** `app.native` completo con comandos Tauri tipados en Rust bajo namespace público `plugin:*`, keychain, ventanas, atajos, bandeja. Documentación y tests.
- **Fase 4 — Hub y DX:** Manifiesto v1 con hash/firma/commit, instalación, actualización con diff de permisos, rollback, escaneo estático, Modo Restringido, panel de errores, dev mode y hot reload.
- **Fase 5 — Estabilidad y Conformidad:** Snapshot de API en CI con `@microsoft/api-extractor`, test-kit `@indexly/plugin-test-kit`, los 3 plugins de ejemplo (`hello-command`, `custom-view-react`, `importer-csv`), auditoría de superficie pública.

---

## 11. Criterios de Aceptación Verificables

1. Un plugin puede registrar comando, vista, ribbon, status bar, settings tab, importer, search provider y contexto de menú; todo se desregistra en orden LIFO en `onunload()`.
2. El test de fugas ejecuta 100 ciclos de activación/desactivación sin dejar listeners de DOM, intervalos, timeouts ni suscripciones Tauri IPC.
3. Un plugin con excepciones no bloquea la aplicación; tras 10 errores en 5 minutos se notifica y ofrece su desactivación.
4. Un `onload()` asíncrono que no resuelve a los 10 segundos es cancelado, su `generationId` queda invalidado y registros tardíos son descartados.
5. Hot reload en `plugins-dev/` recarga el código y estilos sin reiniciar la aplicación.
6. `tsc --noEmit` compila con éxito los 3 ejemplos contra `indexly.d.ts`.
7. El snapshot de API en CI detecta cambios incompatibles y bloquea el build.
8. Plugins v1–v3 existentes siguen funcionando mediante `app.legacy` y el normalizador de manifiestos grandfathering.
9. El Modo Restringido arranca la aplicación con cero plugins de terceros cargados.
10. La instalación exige activación voluntaria; una actualización con permisos nuevos emite aviso con diff.
11. `app.native` cubre `fs`, `path`, `process`, `net`, `shell`, `clipboard`, `notifications`, `tray`, `shortcuts`, `windows`, `os`, `keychain`, `db` con comandos Tauri tipados bajo namespace público.
12. `cargo test`, `cargo clippy -D warnings`, `tsc --noEmit`, `vitest` y build de Tauri pasan en Windows, macOS y Linux.

---

## 12. Anti-Goals Explícitos

- No sandbox, no iframes, no procesos separados para plugins.
- No permisos cosméticos que aparenten bloquear en runtime y no bloqueen. Si son informativos, se documenta y refleja en la UI.
- No `eval` ni `new Function` fuera del loader del host.
- No exposición accidental de módulos internos o comandos privados de Tauri como API pública.
- No renombrar ni eliminar métodos existentes de la API pública en `1.x`. Deprecar y mantener.
- No cargar plugins antes de `onLayoutReady` ni bloquear el arranque inicial de la interfaz.
- No colocar lógica de negocio de la app en `PluginHost`; el host solo carga, orquesta y desregistra.
- No inyectar React global que colisione con dependencias de plugins.
- No permitir registros sin función de limpieza asociada.
- No usar `localStorage` para almacenamiento de secretos.
- No activar plugins automáticamente ni auto-actualizar sin consentimiento explícito.
- No declarar finalizada ninguna fase sin pruebas automatizadas verdes y documentación actualizada.
