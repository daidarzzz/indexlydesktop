# Contrato Dorado de la API Pública de IndexLy Desktop (Golden Contract v1)

Este documento define la instantánea inmutable de la superficie pública del paquete `indexly`.
Cualquier cambio a esta superficie debe ser **estrictamente aditivo**. La eliminación o renombrado
de cualquier propiedad, método o tipo provocará el fallo del test de contrato (`ApiSnapshot.test.ts`).

---

## 1. Raíz del Grafo de Host (`App`)

| Propiedad | Tipo / Firma | Descripción |
| :--- | :--- | :--- |
| `version` | `readonly string` | Versión semántica del host IndexLy (p. ej. "0.1.0") |
| `apiVersion` | `readonly string` | Versión del contrato de plugins (fijado en "1.0.0") |
| `features` | `readonly FeatureSet` | Detección de capacidades runtime del host |
| `library` | `readonly LibraryApi` | Gestión de fuentes, colecciones e ítems unificados |
| `search` | `readonly SearchApi` | Motor de búsqueda FTS5, streaming y proveedores |
| `workspace` | `readonly WorkspaceApi` | Gestión de hojas, vistas, barras y ventanas |
| `commands` | `readonly CommandsApi` | Registro y ejecución de comandos en paleta |
| `settings` | `readonly SettingsApi` | Lectura y persistencia de ajustes de configuración |
| `importer` | `readonly ImporterApi` | Pipeline extensible de importación de archivos |
| `hub` | `readonly HubApi` | Catálogo oficial, instalación, auditoría y actualización |
| `native` | `readonly NativeApi` | Acceso directo y tipado al sistema operativo y backend Rust |
| `events` | `readonly EventsApi` | Bus reactivo de eventos del host namespaced |
| `storage` | `readonly StorageApi` | Persistencia en disco aislada por plugin (`data.json`) |
| `ui` | `readonly UiApi` | Componentes de interfaz gráfica, modales y temas |
| `legacy` | `readonly LegacyApi` | Capa de retrocompatibilidad con `window.IndexLy` v0 |

---

## 2. Métodos de `Plugin` (Clase Base)

Todos los métodos `register*` y `add*` garantizan desmantelamiento automático en orden inverso al registro (LIFO) durante `onunload()`.

| Método | Firma |
| :--- | :--- |
| `constructor` | `(app: App, manifest: PluginManifest)` |
| `onload` | `(): void \| Promise<void>` (Timeout: 10s) |
| `onunload` | `(): void \| Promise<void>` (Timeout: 5s, idempotente) |
| `addCommand` | `(cmd: Command): Command` |
| `addRibbonIcon` | `(icon: string, title: string, cb: (ev: MouseEvent) => unknown): HTMLElement` |
| `addStatusBarItem` | `(): HTMLElement` |
| `addSettingTab` | `(tab: PluginSettingTab): void` |
| `registerView` | `(type: string, factory: (leaf: WorkspaceLeaf) => View): void` |
| `registerEvent` | `(ref: EventRef): void` |
| `registerDomEvent` | `(el: HTMLElement \| Window \| Document, type: string, cb: Function): void` |
| `registerInterval` | `(id: number): number` |
| `register` | `(cb: () => unknown): void` |
| `loadData` | `<T = unknown>(): Promise<T \| null>` |
| `saveData` | `(data: unknown): Promise<void>` |

---

## 3. APIs Modulares de Dominio

### `app.library`
- `getSources(): Promise<Source[]>`
- `getSource(id: string): Promise<Source | null>`
- `addSource(input: AddSourceInput): Promise<Source>`
- `updateSource(id: string, patch: Partial<Source>): Promise<Source>`
- `removeSource(id: string): Promise<void>`
- `getItems(query?: LibraryQuery): Promise<Item[]>`
- `getItem(id: string): Promise<Item | null>`
- `on(event: 'source:added' | 'source:updated' | 'source:removed' | 'sources:changed' | 'items:changed', cb: Function): EventRef`

### `app.search`
- `query(q: string, opts?: SearchOptions): Promise<SearchResults>`
- `queryStream(q: string, opts?: SearchOptions): AsyncIterable<SearchStreamItem>` (Soporta `opts.signal` para cancelación cooperativa)
- `registerProvider(provider: SearchProvider): void`
- `unregisterProvider(id: string): void`
- `reindex(sourceId?: string): Promise<void>`
- `on(event: 'query:before' | 'query:after', cb: Function): EventRef`

### `app.workspace`
- `getActiveWindow(): Window | null`
- `getWindows(): Window[]`
- `getLeaves(): WorkspaceLeaf[]`
- `getLeaf(type?: string): WorkspaceLeaf | null`
- `revealLeaf(leaf: WorkspaceLeaf): void`
- `detachLeavesOfType(type: string): void`
- `onLayoutReady(cb: () => void): void`
- `on(event: 'layout-change' | 'window:open' | 'window:close', cb: Function): EventRef`
- `openSpotlight(): void`

### `app.commands`
- `addCommand(cmd: Command): Command`
- `removeCommand(id: string): void`
- `executeCommand(id: string, ...args: unknown[]): Promise<unknown>`
- `listCommands(): Command[]`
- `addContextMenuItem(item: unknown): void`

### `app.settings`
- `registerSection(sec: SettingsSection): void`
- `registerTab(tab: PluginSettingTab): void`
- `get<T>(key: string): T | undefined`
- `set(key: string, value: unknown): Promise<void>`
- `onChange(cb: (key: string, value: unknown) => void): EventRef`

### `app.importer`
- `registerImporter(def: ImporterDefinition): void`
- `importFile(filePath: string, opts?: { signal?: AbortSignal }): Promise<ImportResult>`
- `on(event: 'import:progress' | 'import:done' | 'import:error', cb: Function): EventRef`

### `app.hub`
- `search(query: string): Promise<HubPluginSummary[]>`
- `getPlugin(id: string): Promise<HubPluginDetail | null>`
- `install(id: string, version?: string): Promise<void>`
- `update(id: string): Promise<void>`
- `uninstall(id: string): Promise<void>`
- `listInstalled(): LoadedPluginInfo[]`

### `app.native`
- `invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>` (Acceso a commands `plugin:*` en Rust)
- `fs`: `read`, `readText`, `write`, `readDir`, `mkdir`, `remove`, `rename`, `stat`, `watch`
- `path`: `join`, `resolve`, `dirname`, `basename`, `extname`, `appData`, `appConfig`, `home`, `temp`, `sep`
- `process`: `spawn`, `exec`, `kill`, `env`, `cwd`
- `http`: `request` (Proxy HTTP nativo en Rust, sin CORS; para servicios locales como qBittorrent)
- `net`: `fetch`, `download` (Legacy: `fetch` usa el navegador y **no** evita CORS)
- `clipboard`: `readText`, `writeText`, `readImage`
- `notify`: `send`, `isPermissionGranted`, `requestPermission`
- `tray`: `setTitle`, `setIcon`, `setTooltip`, `setMenu`
- `shortcuts`: `register`, `unregister`, `unregisterAll`, `isRegistered`
- `windows`: `create`, `get`, `getAll`, `getCurrent`
- `os`: `platform`, `arch`, `version`, `hostname`
- `db`: `query` (Conexión SQLite de solo lectura con `PRAGMA query_only = ON;`), `exec`
- `keychain`: `get`, `set`, `delete` (Almacenamiento persistente de secretos)

---

## 4. Jerarquía de Errores Tipados (`IndexlyError`)

```
IndexlyError (base)
 ├── PluginTimeoutError (phase: 'onload' | 'onunload', timeoutMs: number)
 ├── ZombifiedPluginError (generationId: number)
 ├── PluginCrashError (pluginId: string, phase: string, originalError: Error)
 ├── ValidationError (message: string)
 ├── NativeError (code: string, originalError?: Error)
 └── AccessDeniedError (resource: string)
```

---

## 5. Componentes y Utilidades UI

- `Modal`: Ventana flotante accesible con ciclo de vida `open()` y `close()`.
- `PluginSettingTab`: Pestaña dedicada con interfaz configurable en el panel de Preferencias.
- `Setting`: Creador de filas de configuración fluidas (`setName`, `setDesc`, `addText`, `addToggle`, `addDropdown`, `addButton`).
- `Notice`: Notificaciones flotantes ligeras estilo toast con duración parametrizable.
- `Menu`: Menús contextuales nativos y web con soporte para atajos e iconos.
- `SuggestModal`: Modal de autocompletado y selección de opciones en lista.
- `FuzzySuggestModal`: Modal de búsqueda difusa con filtrado en tiempo real.

---

## 6. Superficie de Plugin Legacy (`IndexLy.plugin`)

Los plugins cargados con `IndexLy.plugin({ id, activate, deactivate })` reciben un objeto `api` con los mismos módulos de dominio, más los puntos de montaje heredados (`addSection`, `addCardAction`, `on`, `showToast`, `modal`, `openLink`, `copyToClipboard`, `escapeHtml`, `refreshApp`). Además de `app.native.http` y `app.native.keychain`, esta superficie expone:

### `api.sources`
- `list(): Promise<Source[]>`
- `get(id: string): Source | null`
- `getItems(id: string): Promise<UnifiedItem[]>`
- `toggle(id: string, active: boolean): Promise<void>`
- `delete(id: string): Promise<void>`
- `remove(id: string): Promise<void>`
- `add(input: AddSourceInput): Promise<Source>`
- `importFile(name: string, content: string, mapping?: MappingConfig): Promise<Source[]>`
- `updateMapping(id: string, name: string, mapping: MappingConfig, flags?: Record<string, boolean>): Promise<Source>`
- `getMappingInfo(id: string): Promise<unknown>`
- `update(id: string, patch: unknown): void`
- `syncItems(input: { sourceId?: string; name: string; items: UnifiedItem[]; flags?: Record<string, boolean> }): Promise<Source>`

`syncItems` crea o actualiza **una sola fuente** gestionada por el plugin y reemplaza todos sus items en una transacción atómica. Es la vía recomendada para mantener una fuente única (por ejemplo `🧲 Torrents`) sin duplicar entradas en el gestor de fuentes. El `sourceId` es opcional: si se omite, se resuelve por nombre exacto y, si no existe, se genera un UUID. El estado `active` previo del usuario se preserva.
