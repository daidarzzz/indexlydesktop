# Especificación Completa de Tipos de la API Pública (`indexly`)

Este documento define la totalidad de las interfaces, tipos y clases públicas exportadas por el paquete `@indexly/plugin-api` (disponible como `require('indexly')`).

---

## 1. El Grafo Raíz `App`

```ts
export interface App {
  readonly version: string;
  readonly apiVersion: string;
  readonly features: FeatureSet;
  readonly library: LibraryApi;
  readonly search: SearchApi;
  readonly workspace: WorkspaceApi;
  readonly commands: CommandsApi;
  readonly settings: SettingsApi;
  readonly importer: ImporterApi;
  readonly hub: HubApi;
  readonly native: NativeApi;
  readonly events: EventsApi;
  readonly storage: StorageApi;
  readonly ui: UiApi;
  readonly legacy: LegacyApi;
}

export interface FeatureSet {
  has(feature: string): boolean;
  list(): readonly string[];
}
```

---

## 2. Tipos de Dominio y Modelos Centrales

```ts
export interface UnifiedItem {
  readonly id: string;
  readonly source_id: string;
  readonly source_name: string;
  readonly title: string;
  readonly subtitle?: string | null;
  readonly file_size?: string | null;
  readonly file_size_bytes?: number | null;
  readonly link?: string | null;
  readonly raw?: string | null;
}

export interface Source {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly count: number;
  readonly mapping?: MappingConfig | null;
  readonly pkg?: PackageInfo | null;
  readonly flags?: Record<string, boolean> | null;
}

export interface MappingConfig {
  titleKey?: string | null;
  linkKey?: string | null;
  subtitleKey?: string | null;
}

export interface PackageInfo {
  slug: string;
  name?: string | null;
}

export interface AddSourceInput {
  name: string;
  rawData?: unknown;
  content?: string;
  mapping?: MappingConfig;
}

export interface LibraryQuery {
  sourceId?: string;
  limit?: number;
  offset?: number;
  filterLink?: 'link' | 'nolink' | null;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  filterLink?: 'link' | 'nolink' | null;
  sortBy?: 'relevance' | 'title-asc' | 'title-desc' | 'size-asc' | 'size-desc';
  signal?: AbortSignal;
}

export interface SearchResults {
  readonly items: UnifiedItem[];
  readonly total: number;
  readonly active_sources_count: number;
  readonly total_items_count: number;
  readonly took_ms: number;
}

export interface SearchHit {
  readonly item: UnifiedItem;
  readonly score: number;
  readonly matchField: string;
}

export interface SearchProvider {
  readonly id: string;
  readonly name: string;
  search(query: string, opts?: SearchOptions): Promise<SearchResults>;
}

export interface SearchContext {
  query: string;
  filterLink?: string | null;
  sortBy: string;
  limit: number;
  offset: number;
  results?: SearchResults;
}

export interface Command {
  id: string;
  name: string;
  icon?: string;
  defaultShortcut?: string;
  callback?: () => void | Promise<void>;
  checkCallback?: (checking: boolean) => boolean | void;
}

export interface ContextMenuItem {
  id: string;
  title: string;
  icon?: string;
  onClick: () => void;
}

export interface EventRef {
  readonly id: string;
  readonly event: string;
}

export interface WorkspaceLeaf {
  readonly id: string;
  view: View | null;
  open(view: View): Promise<void>;
  detach(): void;
}

export abstract class View {
  public leaf: WorkspaceLeaf;
  public containerEl: HTMLElement;
  constructor(leaf: WorkspaceLeaf);
  abstract getViewType(): string;
  abstract getDisplayText(): string;
  abstract getIcon(): string;
  onOpen(): Promise<void>;
  onClose(): Promise<void>;
}

export abstract class ItemView extends View {
  public contentEl: HTMLElement;
  constructor(leaf: WorkspaceLeaf);
}
```

---

## 3. La Clase Base `Plugin` y Jerarquía de Componentes

```ts
export class Component {
  protected _loaded: boolean;
  load(): Promise<void>;
  unload(): Promise<void>;
  register(cb: () => unknown): void;
  registerEvent(ref: EventRef): void;
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window | Document,
    type: K,
    cb: (ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  registerInterval(id: number): number;
  registerTimeout(id: number): number;
}

export abstract class Plugin extends Component {
  public readonly app: App;
  public readonly manifest: PluginManifest;

  constructor(app: App, manifest: PluginManifest);

  abstract onload(): void | Promise<void>;
  onunload(): void | Promise<void>;

  addCommand(cmd: Command): Command;
  addRibbonIcon(icon: string, title: string, cb: (ev: MouseEvent) => unknown): HTMLElement;
  addStatusBarItem(): HTMLElement;
  addSettingTab(tab: PluginSettingTab): void;
  registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void;

  loadData<T = unknown>(): Promise<T | null>;
  saveData(data: unknown): Promise<void>;
}
```

---

## 4. Primitivas de UI (`app.ui`)

```ts
export abstract class Modal {
  public readonly app: App;
  public scope: unknown;
  public containerEl: HTMLElement;
  public modalEl: HTMLElement;
  public titleEl: HTMLElement;
  public contentEl: HTMLElement;

  constructor(app: App);
  open(): void;
  close(): void;
  abstract onOpen(): void;
  abstract onClose(): void;
}

export abstract class PluginSettingTab {
  public readonly app: App;
  public readonly plugin: Plugin;
  public containerEl: HTMLElement;

  constructor(app: App, plugin: Plugin);
  abstract display(): void;
  hide(): void;
}

export class Setting {
  public settingEl: HTMLElement;
  public infoEl: HTMLElement;
  public nameEl: HTMLElement;
  public descEl: HTMLElement;
  public controlEl: HTMLElement;

  constructor(containerEl: HTMLElement);
  setName(name: string): this;
  setDesc(desc: string): this;
  addText(cb: (text: TextComponent) => unknown): this;
  addToggle(cb: (toggle: ToggleComponent) => unknown): this;
  addButton(cb: (button: ButtonComponent) => unknown): this;
  addDropdown(cb: (dropdown: DropdownComponent) => unknown): this;
}

export class Notice {
  public noticeEl: HTMLElement;
  constructor(message: string, duration?: number);
  hide(): void;
}
```

### Biblioteca React (`app.ui.components`)

Además de las primitivas DOM anteriores, `app.ui` expone la biblioteca nativa de
componentes React de IndexLy:

```ts
export interface UiApi {
  getTheme(): 'dark' | 'light';
  onThemeChange(cb: (theme: string) => void): EventRef;
  readonly components: UiKit; // Button, Card, Modal, Tabs, Field, …
  mount(node: ReactNode, container: Element | string): Root;
  unmount(container: Element | string): void;
}
```

Los plugins pueden obtener `React`, `ui`, `mount` y `unmount` desde
`require('indexly')`. Consulta la guía completa en
[`ui-kit.md`](./ui-kit.md).

---

## 5. Taxonomía Formal de Errores

```ts
export class IndexlyError extends Error {
  public readonly code: string;
  public readonly pluginId?: string;
  public readonly cause?: unknown;

  constructor(message: string, code: string, pluginId?: string, cause?: unknown) {
    super(message);
    this.name = 'IndexlyError';
    this.code = code;
    this.pluginId = pluginId;
    this.cause = cause;
  }
}

export class PluginLifecycleError extends IndexlyError {
  constructor(message: string, pluginId: string, cause?: unknown) {
    super(message, 'ERR_PLUGIN_LIFECYCLE', pluginId, cause);
    this.name = 'PluginLifecycleError';
  }
}

export class PluginTimeoutError extends IndexlyError {
  constructor(message: string, pluginId: string, phase: 'onload' | 'onunload') {
    super(message, phase === 'onload' ? 'ERR_PLUGIN_ONLOAD_TIMEOUT' : 'ERR_PLUGIN_ONUNLOAD_TIMEOUT', pluginId);
    this.name = 'PluginTimeoutError';
  }
}

export class NativeError extends IndexlyError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, undefined, cause);
    this.name = 'NativeError';
  }
}

export class StorageError extends IndexlyError {
  constructor(message: string, code: string, pluginId?: string) {
    super(message, code, pluginId);
    this.name = 'StorageError';
  }
}

export class ValidationError extends IndexlyError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'ValidationError';
  }
}
```

---

## 6. Ejemplo Canónico Estrictamente Tipado

```ts
import { App, Plugin, PluginManifest, PluginSettingTab, Setting, Notice } from 'indexly';

export default class MiPlugin extends Plugin {
  private syncTimer: number | null = null;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload(): Promise<void> {
    new Notice(`Plugin ${this.manifest.name} iniciado`);

    this.addCommand({
      id: 'saludar',
      name: 'Saludar al Usuario',
      callback: () => {
        new Notice('¡Hola desde IndexLy Desktop!');
      },
    });

    this.addRibbonIcon('star', 'Abrir Spotlight', () => {
      this.app.workspace.openSpotlight();
    });

    this.addSettingTab(new MiConfigTab(this.app, this));

    // Registro reversible de eventos y timers
    this.registerDomEvent(window, 'resize', () => {
      console.log('Ventana redimensionada');
    });

    this.syncTimer = this.registerInterval(
      window.setInterval(() => {
        this.sincronizar();
      }, 60000)
    );
  }

  async onunload(): Promise<void> {
    new Notice(`Plugin ${this.manifest.name} descargado limpiamente`);
  }

  private async sincronizar(): Promise<void> {
    const sources = await this.app.library.getSources();
    console.log(`Fuentes activas: ${sources.length}`);
  }
}

class MiConfigTab extends PluginSettingTab {
  private pluginInstance: MiPlugin;

  constructor(app: App, plugin: MiPlugin) {
    super(app, plugin);
    this.pluginInstance = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.replaceChildren();

    const header = document.createElement('h2');
    header.textContent = `Ajustes de ${this.pluginInstance.manifest.name}`;
    containerEl.appendChild(header);

    new Setting(containerEl)
      .setName('Sincronización Automática')
      .setDesc('Habilita la sincronización periódica de fuentes en segundo plano.')
      .addToggle((toggle) => {
        toggle.setValue(true);
      });
  }
}
```
