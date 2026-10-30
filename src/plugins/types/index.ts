/**
 * @file src/plugins/types/index.ts
 * @description Definición canónica de tipos para la API de Plugins de IndexLy Desktop (v1).
 * Todas las interfaces son estrictamente tipadas sin uso de `any` no controlado.
 */

// ============================================================================
// 1. Modelos de Dominio de Datos
// ============================================================================

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

export interface MappingConfig {
  titleKey?: string | null;
  linkKey?: string | null;
  subtitleKey?: string | null;
}

export interface PackageInfo {
  slug: string;
  name?: string | null;
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

// ============================================================================
// 2. Búsqueda y Resultados FTS5
// ============================================================================

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

// ============================================================================
// 3. Comandos, Espacio de Trabajo y UI
// ============================================================================

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

export interface WindowInfo {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly visible: boolean;
  readonly focused: boolean;
}

export interface WindowOptions {
  label: string;
  title: string;
  url?: string;
  width?: number;
  height?: number;
  center?: boolean;
  decorations?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
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

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.containerEl = document.createElement('div');
    this.containerEl.classList.add('indexly-view-container');
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;
  abstract getIcon(): string;

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export abstract class ItemView extends View {
  public contentEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl = document.createElement('div');
    this.contentEl.classList.add('indexly-item-view-content');
    this.containerEl.appendChild(this.contentEl);
  }
}

// ============================================================================
// 4. Manifiesto y Metadatos de Plugin
// ============================================================================

export interface PluginManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  minHostVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  repository?: string;
  license: string;
  isDesktopOnly?: boolean;
  main: string;
  styles?: string;
  permissions?: string[];
  hash?: string;
  signature?: string;
  sourceCommit?: string;
  contributes?: {
    commands?: Array<{ id: string; name: string; defaultShortcut?: string }>;
    views?: Array<{ type: string; name: string; icon?: string }>;
    settings?: Array<{ key: string; title: string; type: string; default?: unknown }>;
  };
  enabled?: boolean;
  entry_ui?: string;
  entry_backend?: string;
  settings?: any[];
}

export interface LoadedPluginInfo {
  readonly manifest: PluginManifest;
  readonly isLoaded: boolean;
  readonly hasError: boolean;
  readonly errorCount: number;
  readonly lastError?: string;
}

// ============================================================================
// 5. Módulos de la API del Host (`app.*`)
// ============================================================================

export interface FeatureSet {
  has(feature: string): boolean;
  list(): readonly string[];
}

export interface LibraryApi {
  getSources(): Promise<Source[]>;
  getSource(id: string): Promise<Source | null>;
  addSource(input: AddSourceInput): Promise<Source>;
  updateSource(id: string, patch: Partial<Source>): Promise<Source>;
  removeSource(id: string): Promise<void>;
  getItems(query: LibraryQuery): Promise<UnifiedItem[]>;
  getItem(id: string): Promise<UnifiedItem | null>;
  on(event: 'source:added' | 'source:updated' | 'source:removed' | 'items:changed', cb: (payload: any) => void): EventRef;
}

export interface SearchApi {
  query(q: string, opts?: SearchOptions): Promise<SearchResults>;
  queryStream(q: string, opts?: SearchOptions): AsyncIterable<SearchHit>;
  registerProvider(provider: SearchProvider): void;
  unregisterProvider(id: string): void;
  reindex(sourceId?: string): Promise<void>;
  on(event: 'query:before' | 'query:after', cb: (ctx: SearchContext) => void): EventRef;
}

export interface WorkspaceApi {
  getActiveWindow(): WindowInfo;
  getWindows(): WindowInfo[];
  getLeaves(): WorkspaceLeaf[];
  getLeaf(type?: string): WorkspaceLeaf;
  revealLeaf(leaf: WorkspaceLeaf): void;
  detachLeavesOfType(type: string): void;
  onLayoutReady(callback: () => void): void;
  openSpotlight(): Promise<void>;
  on(event: 'layout-change' | 'window:open' | 'window:close', cb: (data: any) => void): EventRef;
}

export interface CommandsApi {
  addCommand(command: Command): Command;
  removeCommand(id: string): void;
  executeCommand(id: string, ...args: unknown[]): Promise<boolean>;
  listCommands(): Command[];
  addContextMenuItem(item: ContextMenuItem): EventRef;
}

export interface SettingSection {
  id: string;
  name: string;
  render: (container: HTMLElement) => void;
}

export interface SettingsApi {
  registerSection(section: SettingSection): void;
  registerTab(tab: unknown): void;
  get<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  onChange(keyOrCb: string | ((key: string, val: unknown) => void), cb?: (val: unknown) => void): EventRef;
}

export interface CustomImporter {
  readonly id: string;
  readonly name: string;
  readonly extensions: string[];
  canHandle(filename: string, contentPrefix: string): boolean;
  parse(content: string, filename: string): Promise<Source[]>;
}

export interface ImportProgress {
  readonly current: number;
  readonly total: number;
  readonly stage: string;
}

export interface ImporterApi {
  registerImporter(importer: CustomImporter): EventRef;
  importFile(pathOrContent: string, opts?: unknown): Promise<Source[]>;
  on(event: 'import:progress', cb: (p: ImportProgress) => void): EventRef;
}

export interface HubPluginSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly downloads: number;
}

export interface HubPluginDetail extends HubPluginSummary {
  readonly repository?: string;
  readonly permissions: string[];
  readonly minHostVersion: string;
  readonly hash: string;
  readonly sourceCommit?: string;
}

export interface HubApi {
  search(query: string): Promise<HubPluginSummary[]>;
  getPlugin(id: string): Promise<HubPluginDetail | null>;
  install(id: string, version?: string): Promise<void>;
  update(id: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  listInstalled(): LoadedPluginInfo[];
}

export interface EventsApi {
  on(event: string, callback: (data: any) => void): EventRef;
  off(ref: EventRef): void;
  emit(event: string, payload?: unknown): void;
}

export interface StorageApi {
  pluginDataDir(id: string): Promise<string>;
  readJson<T = unknown>(filename: string): Promise<T | null>;
  writeJson(filename: string, data: unknown): Promise<void>;
  readText(filename: string): Promise<string>;
  writeText(filename: string, content: string): Promise<void>;
  remove(filename: string): Promise<void>;
}

export interface UiApi {
  getTheme(): 'dark' | 'light';
  onThemeChange(cb: (theme: string) => void): EventRef;
}

export interface LegacyApi {
  apiVersion: number;
  [key: string]: unknown;
}

// ============================================================================
// 6. Superficie Nativa (`app.native`)
// ============================================================================

export interface FileStat {
  readonly size: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly modifiedAt?: number;
}

export interface DirEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly path: string;
}

export interface WatchEvent {
  readonly type: 'create' | 'modify' | 'delete';
  readonly paths: string[];
}

export interface ChildHandle {
  readonly pid: number;
  kill(): Promise<void>;
  wait(): Promise<number>;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface TrayHandle {
  readonly id: string;
}

export interface TrayOptions {
  icon: string;
  tooltip?: string;
  menu?: Array<{ id: string; label: string; onClick: () => void }>;
}

export interface NativeApi {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  fs: {
    read(path: string): Promise<Uint8Array>;
    readText(path: string): Promise<string>;
    write(path: string, data: Uint8Array | string): Promise<void>;
    readDir(path: string): Promise<DirEntry[]>;
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
    remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    stat(path: string): Promise<FileStat>;
    watch(path: string, cb: (ev: WatchEvent) => void): Promise<() => void>;
  };
  path: {
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
    dirname(p: string): string;
    basename(p: string): string;
    extname(p: string): string;
    appData(): Promise<string>;
    appConfig(): Promise<string>;
    home(): Promise<string>;
    temp(): Promise<string>;
    sep: string;
  };
  process: {
    spawn(cmd: string, args?: string[], opts?: SpawnOptions): Promise<ChildHandle>;
    exec(cmd: string, opts?: ExecOptions): Promise<{ code: number; stdout: string; stderr: string }>;
    kill(pid: number): Promise<void>;
    env(): Promise<Record<string, string>>;
    cwd(): Promise<string>;
  };
  net: {
    fetch(input: string | Request, init?: RequestInit): Promise<Response>;
    download(url: string, dest: string, onProgress?: (n: number) => void): Promise<void>;
    listen(port: number, cb: (req: unknown) => void): Promise<() => void>;
  };
  shell: {
    openPath(p: string): Promise<void>;
    openUrl(u: string): Promise<void>;
    showInFolder(p: string): Promise<void>;
  };
  clipboard: {
    readText(): Promise<string>;
    writeText(s: string): Promise<void>;
    readImage(): Promise<Uint8Array | null>;
    writeImage(b: Uint8Array): Promise<void>;
  };
  notifications: {
    send(opts: { title: string; body?: string; icon?: string }): Promise<void>;
  };
  tray: {
    create(opts: TrayOptions): Promise<TrayHandle>;
    update(h: TrayHandle, opts: Partial<TrayOptions>): Promise<void>;
    remove(h: TrayHandle): Promise<void>;
  };
  shortcuts: {
    register(accel: string, cb: () => void): Promise<() => void>;
    unregister(accel: string): Promise<void>;
  };
  windows: {
    create(opts: WindowOptions): Promise<string>;
    list(): Promise<WindowInfo[]>;
    focus(id: string): Promise<void>;
    close(id: string): Promise<void>;
  };
  os: {
    platform(): 'windows' | 'macos' | 'linux';
    arch(): string;
    version(): Promise<string>;
    locale(): string;
  };
  keychain: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  db: {
    query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    exec(sql: string): Promise<void>;
  };
}

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
