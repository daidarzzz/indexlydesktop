# Superficie de APIs Nativas (`app.native`)

El módulo `app.native` proporciona acceso estructurado y de alto rendimiento a las capacidades del sistema operativo mediante comandos IPC fuertemente tipados implementados en Rust (Tauri v2).

---

## 1. Restricción de Namespace en `invoke`

```ts
app.native.invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
```

Para asegurar el contrato de estabilidad y evitar el acoplamiento accidental con comandos internos del host que puedan variar entre versiones:
1. **Namespace Público Permitido:** `invoke` solo acepta comandos con prefijo `plugin:*` (p. ej. `plugin:fs_read`, `plugin:process_spawn`) o comandos registrados explícitamente por plugins nativos de Tauri.
2. **Rechazo de Comandos Privados:** Cualquier intento de invocar comandos internos privados del host (`core:*`, `__host_private_*`) es interceptado y rechazado con una excepción `NativeError` (`ERR_INVOKE_DISALLOWED`).

---

## 2. Módulos y Métodos

### 2.1 `app.native.db` (Acceso a SQLite y Resolución de `db:write`)
- **`query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>`**: Ejecuta consultas `SELECT` sobre un pool de conexiones SQLite separado configurado en **solo lectura** (`PRAGMA query_only = ON`), garantizando que búsquedas o escaneos intensivos de plugins no interfieran ni bloqueen las escrituras del host.
- **`exec(sql: string): Promise<void>`**: Ejecuta sentencias de mutación de esquema o datos sobre la conexión de escritura. 
  - *Filosofía de confianza:* No se bloquea artificialmente en runtime.
  - *Transparencia:* Requiere declarar `"permissions": ["db:write"]` en `manifest.json`. La UI advierte al usuario durante la instalación y el análisis estático del Hub audita su uso.

---

### 2.2 `app.native.fs` (Sistema de Archivos)
Manipulación directa y atómica de archivos locales:

- `read(path: string): Promise<Uint8Array>`: Lectura de contenido binario.
- `readText(path: string): Promise<string>`: Lectura de texto en UTF-8.
- `write(path: string, data: Uint8Array | string): Promise<void>`: Escritura atómica a disco.
- `readDir(path: string): Promise<DirEntry[]>`: Listado de entradas de un directorio.
- `mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>`: Creación de directorios.
- `remove(path: string, opts?: { recursive?: boolean }): Promise<void>`: Eliminación de archivos o carpetas.
- `rename(from: string, to: string): Promise<void>`: Movimiento o renombrado de ficheros.
- `stat(path: string): Promise<FileStat>`: Metadatos de tamaño, permisos y marcas temporales.
- `watch(path: string, cb: (ev: WatchEvent) => void): Promise<() => void>`: Monitorización en tiempo real de directorios.

---

### 2.3 `app.native.path` (Gestión de Rutas)
- `join(...parts: string[]): string`
- `resolve(...parts: string[]): string`
- `dirname(p: string): string`
- `basename(p: string): string`
- `extname(p: string): string`
- `appData(): Promise<string>`: Directorio de datos de la app (`%APPDATA%` en Windows).
- `appConfig(): Promise<string>`
- `home(): Promise<string>`: Carpeta de usuario.
- `temp(): Promise<string>`: Carpeta temporal del sistema.
- `sep: string`: Separador nativo (`\` en Windows, `/` en POSIX).

---

### 2.4 `app.native.process` (Gestión de Procesos)
- `spawn(cmd: string, args?: string[], opts?: SpawnOptions): Promise<ChildHandle>`: Creación de subprocesos con streaming de salida.
- `exec(cmd: string, opts?: ExecOptions): Promise<{ code: number; stdout: string; stderr: string }>`: Ejecución y captura completa.
- `kill(pid: number): Promise<void>`: Cierre forzado de subprocesos.
- `env(): Promise<Record<string, string>>`: Lectura de variables de entorno del sistema.
- `cwd(): Promise<string>`: Directorio de trabajo del proceso anfitrión.

---

### 2.5 `app.native.http` (Peticiones HTTP sin CORS)
Proxy HTTP implementado en Rust (`ureq`). Es la vía recomendada para hablar con servicios locales como qBittorrent, Transmission o Jellyfin, a los que el webview no puede llamar por CORS.

- `request(opts): Promise<{ status: number; headers: Record<string, string>; body: string }>`
  - `opts.method?: string` (`GET` por defecto)
  - `opts.url: string`
  - `opts.headers?: Record<string, string>`
  - `opts.body?: string`
  - `opts.timeoutMs?: number` (15 000 ms por defecto)

Los códigos `4xx`/`5xx` **no** lanzan excepción: se devuelven con su `status` para que el plugin decida. Las cabeceras `Origin`, `Referer`, `Host` y `Content-Length` se descartan deliberadamente (qBittorrent rechaza los POST con `Origin`/`Referer` por CSRF).

> `app.native.net.fetch` se mantiene por compatibilidad, pero internamente usa el `fetch` del navegador: **no** evita CORS. Para servicios locales usa siempre `app.native.http.request`. Ambos módulos están disponibles tanto en la API moderna (`app.native`) como en la superficie legacy (`IndexLy.plugin`).

---

### 2.6 `app.native.keychain` (Llavero Seguro del SO)
Gestión de secretos en el keyring criptográfico del sistema operativo (Windows Credential Manager, Apple Keychain, Secret Service API en Linux):

- `get(key: string): Promise<string | null>`
- `set(key: string, value: string): Promise<void>`
- `delete(key: string): Promise<void>`

*Regla vinculante:* Los tokens de acceso, contraseñas o claves privadas jamás deben almacenarse en `localStorage` ni en `data.json`.

---

### 2.7 Otros Módulos Nativos
- **`shell`**: `openPath(p: string)`, `openUrl(u: string)`, `showInFolder(p: string)`.
- **`clipboard`**: `readText()`, `writeText(s: string)`, `readImage()`, `writeImage(b: Uint8Array)`.
- **`notifications`**: `send(opts: { title: string; body?: string; icon?: string })`.
- **`tray`**: `create(opts: TrayOptions)`, `update(h: TrayHandle, opts: Partial<TrayOptions>)`, `remove(h: TrayHandle)`.
- **`shortcuts`**: `register(accel: string, cb: () => void)`, `unregister(accel: string)`.
- **`windows`**: `create(opts: WindowOptions)`, `list(): Promise<WindowInfo[]>`, `focus(id: string)`, `close(id: string)`.
- **`os`**: `platform(): 'windows' | 'macos' | 'linux'`, `arch(): string`, `version(): Promise<string>`, `locale(): string`.

---

## 3. Véase también

- **`api.sources.syncItems`**: sincronización transaccional de una fuente única gestionada por el plugin (p. ej. `🧲 Torrents`). Documentado en `golden-contract.api.md`, sección 6.
