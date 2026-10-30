# Superficie de APIs Nativas (`app.native`)

El módulo `app.native` proporciona acceso estructurado y de alto rendimiento a las capacidades del sistema operativo mediante comandos IPC fuertemente tipados implementados en Rust (Tauri v2).

---

## 1. Módulos y Métodos

### 1.1 `app.native.fs` (Sistema de Archivos)
Permite la manipulación directa de archivos y directorios en el almacenamiento local.

- **`read(path: string): Promise<Uint8Array>`**: Lee el contenido binario de un archivo.
- **`readText(path: string): Promise<string>`**: Lee un archivo de texto codificado en UTF-8.
- **`write(path: string, data: Uint8Array | string): Promise<void>`**: Escribe datos en un archivo de forma atómica.
- **`readDir(path: string): Promise<DirEntry[]>`**: Lista las entradas de un directorio.
- **`mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>`**: Crea un directorio.
- **`remove(path: string, opts?: { recursive?: boolean }): Promise<void>`**: Elimina un archivo o directorio.
- **`rename(from: string, to: string): Promise<void>`**: Mueve o renombra un elemento en disco.
- **`stat(path: string): Promise<FileStat>`**: Obtiene metadatos de tamaño, fechas de modificación y permisos.
- **`watch(path: string, cb: (ev: WatchEvent) => void): Promise<() => void>`**: Observa cambios en un directorio. Devuelve una función de desregistro.

*Ejemplo:*
```ts
const content = await app.native.fs.readText('C:/datos/catalogo.json');
const stat = await app.native.fs.stat('C:/datos/catalogo.json');
console.log(`Tamaño: ${stat.size} bytes`);
```

---

### 1.2 `app.native.path` (Gestión de Rutas)
Utilidades de normalización de rutas y resolución de directorios estándar del sistema operativo.

- `join(...parts: string[]): string`
- `resolve(...parts: string[]): string`
- `dirname(p: string): string`
- `basename(p: string): string`
- `extname(p: string): string`
- `appData(): Promise<string>`: Directorio de datos de la aplicación (`%APPDATA%`, `~/Library/Application Support`, `~/.config`).
- `appConfig(): Promise<string>`
- `home(): Promise<string>`: Directorio del usuario actual.
- `temp(): Promise<string>`: Directorio temporal del sistema.
- `sep: string`: Separador de rutas nativo (`\` en Windows, `/` en POSIX).

---

### 1.3 `app.native.process` (Gestión de Procesos)
Ejecución asíncrona de binarios y comandos del sistema operativo.

- **`spawn(cmd: string, args?: string[], opts?: SpawnOptions): Promise<ChildHandle>`**: Inicia un proceso secundario con streaming de `stdout`, `stderr` y control de ciclo de vida.
- **`exec(cmd: string, opts?: ExecOptions): Promise<{ code: number; stdout: string; stderr: string }>`**: Ejecuta un comando hasta su finalización y devuelve la salida completa.
- **`kill(pid: number): Promise<void>`**: Termina un proceso por su identificador.
- **`env(): Promise<Record<string, string>>`**: Variables de entorno del proceso actual.
- **`cwd(): Promise<string>`**: Directorio de trabajo actual del proceso.

*Ejemplo:*
```ts
const result = await app.native.process.exec('git', { cwd: 'C:/mi-repo' });
if (result.code === 0) {
  console.log(result.stdout);
}
```

---

### 1.4 `app.native.net` (Red y Transferencias)
- **`fetch(input: string | Request, init?: RequestInit): Promise<Response>`**: Solicitud HTTP de alto rendimiento ejecutada directamente en el backend de Rust (evitando restricciones CORS del navegador).
- **`download(url: string, dest: string, onProgress?: (n: number) => void): Promise<void>`**: Descarga un archivo directamente a disco con notificación continua de progreso.
- **`listen(port: number, cb: (req: unknown) => void): Promise<() => void>`**: Abre un servidor HTTP/TCP local para webhooks o integraciones de depuración.

---

### 1.5 `app.native.shell` (Integración con el Shell del Sistema)
- **`openPath(path: string): Promise<void>`**: Abre un archivo o carpeta con la aplicación predeterminada del sistema.
- **`openUrl(url: string): Promise<void>`**: Abre un enlace en el navegador web predeterminado.
- **`showInFolder(path: string): Promise<void>`**: Abre el explorador de archivos con el elemento seleccionado.

---

### 1.6 `app.native.clipboard` (Portapapeles)
- **`readText(): Promise<string>`**
- **`writeText(s: string): Promise<void>`**
- **`readImage(): Promise<Uint8Array | null>`**
- **`writeImage(b: Uint8Array): Promise<void>`**

---

### 1.7 `app.native.notifications` (Notificaciones Nativas)
- **`send(opts: { title: string; body?: string; icon?: string }): Promise<void>`**: Despacha una notificación del centro de actividades del sistema operativo (Windows Action Center, macOS Notification Center, libnotify en Linux).

---

### 1.8 `app.native.tray` (Bandeja del Sistema)
- **`create(opts: TrayOptions): Promise<TrayHandle>`**: Añade un icono a la bandeja del sistema con menú contextual asociado.
- **`update(h: TrayHandle, opts: Partial<TrayOptions>): Promise<void>`**: Actualiza título, icono o menú.
- **`remove(h: TrayHandle): Promise<void>`**: Retira el icono de la bandeja.

---

### 1.9 `app.native.shortcuts` (Atajos Globales de Teclado)
- **`register(accel: string, cb: () => void): Promise<() => void>`**: Registra un acelerador a nivel de sistema (p. ej. `CommandOrControl+Shift+Space`). Devuelve la función de cancelación.
- **`unregister(accel: string): Promise<void>`**

---

### 1.10 `app.native.windows` (Gestión de Ventanas)
- **`create(opts: WindowOptions): Promise<WindowHandle>`**: Crea una ventana auxiliar nativa (p. ej., visor flotante o spotlight).
- **`list(): Promise<WindowInfo[]>`**: Enumera las ventanas abiertas.
- **`focus(id: string): Promise<void>`**
- **`close(id: string): Promise<void>`**

---

### 1.11 `app.native.os` (Información de la Plataforma)
- **`platform(): 'windows' | 'macos' | 'linux'`**
- **`arch(): string`** (`x86_64`, `aarch64`)
- **`version(): Promise<string>`**
- **`locale(): string`**

---

### 1.12 `app.native.keychain` (Llavero Seguro del Sistema Operativo)
Gestión de credenciales cifradas mediante el keyring nativo de cada sistema (Windows Credential Manager, Apple Keychain, FreeDesktop Secret Service).

- **`get(key: string): Promise<string | null>`**
- **`set(key: string, value: string): Promise<void>`**
- **`delete(key: string): Promise<void>`**

*Regla crítica:* Los tokens de autenticación o secretos nunca deben guardarse en `data.json` o `localStorage`.

---

### 1.13 `app.native.db` (Acceso a SQLite)
- **`query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>`**: Ejecución de consultas `SELECT` sobre una conexión SQLite en **solo lectura**.
- **`exec(sql: string): Promise<void>`**: Ejecución de sentencias DDL o DML de mutación. Requiere que el plugin declare `"permissions": ["db:write"]` y aprobación expresa del usuario.

---

### 1.14 `app.native.invoke` (Escape Hatch)
- **`invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>`**: Mecanismo documentado de escape para comunicarse directamente con cualquier comando Tauri personalizado expuesto en el backend de Rust.

---

## 2. Compatibilidad de Plataformas

| Módulo | Windows | macOS | Linux |
|---|---|---|---|
| `fs` | Soportado (Win32) | Soportado (POSIX) | Soportado (POSIX) |
| `path` | Soportado (`\`) | Soportado (`/`) | Soportado (`/`) |
| `process` | Soportado (`CreateProcess`) | Soportado (`fork/exec`) | Soportado (`fork/exec`) |
| `net` | Soportado (Rust/Reqwest) | Soportado (Rust/Reqwest) | Soportado (Rust/Reqwest) |
| `clipboard` | Soportado | Soportado | Soportado (X11 / Wayland) |
| `notifications` | Soportado (WinRT) | Soportado (UserNotifications) | Soportado (libnotify) |
| `tray` | Soportado | Soportado | Soportado (AppIndicator) |
| `shortcuts` | Soportado | Soportado | Soportado |
| `keychain` | Soportado (Credential Mgr) | Soportado (Keychain Services) | Soportado (Secret Service) |
| `db` | Soportado (rusqlite) | Soportado (rusqlite) | Soportado (rusqlite) |
