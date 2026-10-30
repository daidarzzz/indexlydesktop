# Especificación de la API Pública de IndexLy Desktop (`indexly`)

Este documento especifica la interfaz completa exportada por el paquete npm `@indexly/plugin-api` (disponible en el runtime como `require('indexly')`).

---

## 1. El Objeto Raíz `app`

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
```

---

## 2. Módulos de Dominio

### 2.1 `app.library`
Gestión de fuentes de datos (JSON, CSV, torrents, paquetes del Hub), colecciones y elementos indexados.

- `getSources(): Promise<Source[]>`: Obtiene todas las fuentes configuradas en el host.
- `getSource(id: string): Promise<Source | null>`: Obtiene una fuente específica por su identificador único.
- `addSource(input: AddSourceInput): Promise<Source>`: Agrega una nueva fuente procesando su contenido.
- `updateSource(id: string, patch: Partial<Source>): Promise<Source>`: Modifica metadatos o estado de una fuente.
- `removeSource(id: string): Promise<void>`: Elimina la fuente y todos sus items asociados en SQLite.
- `getItems(query: LibraryQuery): Promise<UnifiedItem[]>`: Recupera items filtrados por fuente o metadato.
- `getItem(id: string): Promise<UnifiedItem | null>`: Recupera un item específico.
- `on(event: 'source:added' | 'source:updated' | 'source:removed' | 'items:changed', cb: (payload: any) => void): EventRef`: Suscripción reactiva a cambios en la biblioteca.

### 2.2 `app.search`
Motor de búsqueda de texto completo FTS5 y registro de proveedores externos.

- `query(q: string, opts?: SearchOptions): Promise<SearchResults>`: Búsqueda paginada en el índice local.
- `queryStream(q: string, opts?: SearchOptions): AsyncIterable<SearchHit>`: Streaming asíncrono con soporte cooperativo de `AbortSignal`.
- `registerProvider(provider: SearchProvider): void`: Permite a un plugin actuar como motor de búsqueda secundario.
- `unregisterProvider(id: string): void`: Desregistra un motor secundario.
- `reindex(sourceId?: string): Promise<void>`: Fuerza la regeneración de tablas virtuales FTS5.
- `on(event: 'query:before' | 'query:after', cb: (ctx: SearchContext) => void): EventRef`: Interceptores para enriquecer o filtrar resultados de búsqueda.

### 2.3 `app.workspace`
Control de ventanas, vistas, pestañas, hojas (`WorkspaceLeaf`), barra de estado y Spotlight.

- `getActiveWindow(): WindowInfo`: Ventana nativa en primer plano.
- `getWindows(): WindowInfo[]`: Listado de ventanas activas.
- `getLeaves(): WorkspaceLeaf[]`: Todas las hojas de trabajo montadas.
- `getLeaf(type?: string): WorkspaceLeaf`: Obtiene o crea una hoja para un tipo de vista.
- `revealLeaf(leaf: WorkspaceLeaf): void`: Concede foco y visibilidad a una hoja.
- `detachLeavesOfType(type: string): void`: Cierra y destruye todas las hojas de un tipo específico.
- `onLayoutReady(callback: () => void): void`: Ejecuta un callback cuando el árbol de la interfaz principal está completamente renderizado.
- `openSpotlight(): Promise<void>`: Abre la ventana de búsqueda rápida flotante.
- `on(event: 'layout-change' | 'window:open' | 'window:close', cb: (data: any) => void): EventRef`

### 2.4 `app.commands`
Paleta de comandos y atajos de teclado.

- `addCommand(command: Command): Command`: Registra un comando en la paleta global.
- `removeCommand(id: string): void`: Elimina un comando.
- `executeCommand(id: string, ...args: unknown[]): Promise<boolean>`: Dispara un comando por programa.
- `listCommands(): Command[]`: Devuelve todos los comandos registrados.
- `addContextMenuItem(item: ContextMenuItem): EventRef`: Añade opciones al menú contextual del ratón.

### 2.5 `app.settings`
Persistencia y pestañas de configuración.

- `registerSection(section: SettingSection): void`: Añade una sección a los ajustes generales.
- `registerTab(tab: PluginSettingTab): void`: Añade una pestaña de configuración exclusiva para el plugin.
- `get<T = unknown>(key: string, defaultValue?: T): Promise<T>`: Lee un valor persistente.
- `set(key: string, value: unknown): Promise<void>`: Guarda un valor persistente.
- `onChange(keyOrCb: string | ((key: string, val: unknown) => void), cb?: (val: unknown) => void): EventRef`: Escucha cambios en ajustes.

### 2.6 `app.importer`
Tubería de importación de archivos.

- `registerImporter(importer: CustomImporter): EventRef`: Registra soporte para nuevas extensiones o formatos (`.epub`, `.m3u8`, `.xml`, etc.).
- `importFile(pathOrContent: string, opts?: ImportOptions): Promise<Source[]>`: Procesa un archivo a través de la tubería de importadores.
- `on(event: 'import:progress', cb: (p: ImportProgress) => void): EventRef`

### 2.7 `app.hub`
Catálogo y ciclo de distribución de extensiones.

- `search(query: string): Promise<HubPluginSummary[]>`: Búsqueda de plugins en el índice del Hub.
- `getPlugin(id: string): Promise<HubPluginDetail | null>`: Detalle del plugin, versiones y permisos.
- `install(id: string, version?: string): Promise<void>`: Descarga y valida un plugin.
- `update(id: string): Promise<void>`: Actualiza a una nueva versión informando de posibles permisos nuevos.
- `uninstall(id: string): Promise<void>`: Desinstala el plugin de forma segura.
- `listInstalled(): LoadedPluginInfo[]`: Plugins instalados localmente.

### 2.8 `app.ui`
Clases y primitivas de interfaz de usuario:

- `Modal`: Ventana modal centrada con botón de cierre, accesibilidad y foco automático.
- `PluginSettingTab`: Pestaña dedicada dentro del diálogo de preferencias.
- `Setting`: Fila de configuración estándar (nombre, descripción, control interactivo).
- `Notice`: Notificación flotante de corta duración en la esquina de la pantalla.
- `Menu`: Menú contextual desplegable flotante.
- `SuggestModal<T>` / `FuzzySuggestModal<T>`: Selector difuso interactivo para búsquedas rápidas.
- `ItemView`: Vista acoplable dentro de un `WorkspaceLeaf`.

---

## 3. Ejemplo Canónico de Plugin

```ts
import { Plugin, Notice, PluginSettingTab, Setting } from 'indexly';

export default class MiPlugin extends Plugin {
  async onload() {
    new Notice(`Plugin ${this.manifest.name} activado`);

    this.addCommand({
      id: 'saludar',
      name: 'Saludar al Usuario',
      callback: () => {
        new Notice('¡Hola desde IndexLy Desktop!');
      }
    });

    this.addRibbonIcon('star', 'Mi Plugin', () => {
      this.app.workspace.openSpotlight();
    });

    this.addSettingTab(new MiConfigTab(this.app, this));
  }

  async onunload() {
    new Notice(`Plugin ${this.manifest.name} desactivado`);
  }
}

class MiConfigTab extends PluginSettingTab {
  plugin: MiPlugin;

  constructor(app: any, plugin: MiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Ajustes de Mi Plugin' });

    new Setting(containerEl)
      .setName('Opción de Ejemplo')
      .setDesc('Habilita la sincronización automática')
      .addToggle((toggle) => {
        toggle.setValue(true);
      });
  }
}
```
