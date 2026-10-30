# Plan de Migración desde el Co-Kernel Actual

Este documento define la estrategia para migrar de la arquitectura Co-Kernel v3 actual (`PluginRegistry.ts`, `window.IndexLy`) a la nueva arquitectura formal de plugins v1 (`PluginHost`, `PluginApi`), subsanando la deuda técnica acumulada sin romper extensiones existentes.

---

## 1. Desacoplamiento Arquitectónico

La lógica monolítica concentrada previamente en `src/plugins/PluginRegistry.ts` (1157 líneas) se segrega formalmente en componentes con responsabilidades únicas:

1. **`src/plugins/host/PluginHost.ts`:** Responsable exclusivo del cargador CJS, ciclo de vida (`onload`/`onunload`), cola de limpieza (`disposables`), monitoreo de timeouts y aislamiento de excepciones (`safeCall`). No contiene lógica de negocio de la aplicación.
2. **`src/plugins/api/PluginApi.ts`:** Implementación del grafo `app.*` (`library`, `search`, `workspace`, `native`, `storage`, `ui`, `commands`, `settings`, `importer`, `hub`).
3. **`src/plugins/legacy/LegacyAdapter.ts`:** Capa de emulación que expone el objeto global `window.IndexLy` para plugins desarrollados para v1, v2 o v3.

---

## 2. Compatibilidad Retroactiva con `window.IndexLy`

Los plugins antiguos continúan funcionando sin requerir modificaciones en su código fuente gracias al adaptador `LegacyAdapter`:

```ts
// src/plugins/legacy/LegacyAdapter.ts
export function createLegacyIndexLyAdapter(app: App): any {
  return {
    apiVersion: 3,
    getSections: () => app.workspace.getLeaves().map(...),
    register: (def: any) => {
      console.warn('[Deprecation Warning] window.IndexLy.register() está obsoleto. Migre a class Plugin.');
      // Mapeo automático al ciclo de vida v1
    },
    plugin: (def: any) => {
      console.warn('[Deprecation Warning] window.IndexLy.plugin() está obsoleto. Migre a class Plugin.');
      // Mapeo automático al ciclo de vida v1
    },
    sources: app.library,
    storage: app.storage,
    native: app.native,
    // ...
  };
}
```

---

## 3. Resolución de la Deuda Técnica (11 Correcciones Vinculantes)

Durante la migración se aplican las correcciones definitivas para los siguientes fallos detectados en el motor previo:

### 3.1 Búsqueda y Rendimiento
1. **Debounce de 25 ms sin cancelación de peticiones:** Se sustituye por un hook de búsqueda que gestiona `AbortController`, cancelando de inmediato las consultas SQLite FTS5 en vuelo cuando el usuario sigue tecleando.
2. **`ORDER BY file_size` textual:** En `src-tauri/src/db.rs` se introduce la columna `file_size_bytes INTEGER` en la tabla `items`, indexada para ordenaciones numéricas instantáneas. La columna `file_size` se preserva como texto formateado de visualización.
3. **Sanitizador FTS5:** Se reemplaza la expresión regular simplista por un parser que respeta frases entre comillas dobles, tokens alfanuméricos y operadores booleanos, evitando errores sintácticos de SQLite.

### 3.2 Ingesta y Normalización de Datos
4. **`addSource` con camelCase ignorado:** Se añade `#[serde(rename_all = "camelCase")]` y alias en `MappingConfig` (`models.rs`) para que los objetos enviados desde TypeScript con `titleKey`, `linkKey` o `subtitleKey` se deserialicen correctamente.
5. **`insert_sources_batch` pierde `flags_json`:** Se corrige la sentencia `INSERT OR REPLACE INTO sources` en `db.rs` para incluir `flags_json`.
6. **Mapping CSV no aplicado:** Se refactoriza `parse_csv_to_items` en `normalizer.rs` para aceptar un `Option<&MappingConfig>` y mapear dinámicamente las cabeceras personalizadas.
7. **Importación tabular `{k, v}` produce 0 items fuera de v2 envelope:** Se actualiza `normalize_json_to_items` para detectar estructuras `{ "k": [...], "v": [...] }` en cualquier nivel de archivo JSON.
8. **`.torrent` genera enlaces magnet sintéticos:** Se implementa un extractor bencode para leer el `info_hash` real y generar magnets válidos (`magnet:?xt=urn:btih:<SHA1>&dn=<nombre>`).

### 3.3 Interfaz de Usuario y Contenedores
9. **`Slot.tsx` con guard `dataset.rendered`:** Se sustituye la marca estática en el DOM por `useEffect` con referencias limpias de montaje y desmontaje.
10. **Vistas custom limpiaban el DOM en cada render:** El contenedor entregado a la vista custom se preserva; el host únicamente invoca callbacks de actualización sin borrar `innerHTML`.

### 3.4 Plataforma e Integración Nativa
11. **Spotlight sin capacidades en `default.json`:** Se agrega la ventana `"spotlight"` a la lista de ventanas en `src-tauri/capabilities/default.json`.
12. **`ensure_bundled_plugins` con ruta hardcodeada de desarrollo:** Se elimina la ruta fija `c:/Users/david/...` y se utiliza la resolución canónica de recursos de Tauri (`app.path().resource_dir()`).

---

## 4. Migración de Persistencia

Los datos almacenados previamente en `IndexedDB` (`indexly_plugin_storage`) o `localStorage` se migran de forma transparente a `<appDataDir>/plugins/<pluginId>/data.json` la primera vez que el plugin se inicia bajo la API v1.
