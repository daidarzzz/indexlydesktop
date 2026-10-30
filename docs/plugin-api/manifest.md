# Especificación del Manifiesto de Plugins (`manifest.json`)

El archivo `manifest.json` es el punto de entrada declarativo que define la identidad, dependencias, integridad criptográfica, puntos de extensión e información de transparencia de un plugin de IndexLy Desktop.

---

## 1. Esquema JSON v1 Completo

```json
{
  "$schema": "https://indexly.app/schemas/v1/plugin-manifest.json",
  "schemaVersion": 1,
  "id": "com.ejemplo.mi-plugin",
  "name": "Mi Primer Plugin",
  "version": "1.0.0",
  "minHostVersion": "0.1.0",
  "description": "Extensión para catalogación avanzada e integración de fuentes externas.",
  "author": "Nombre del Desarrollador",
  "authorUrl": "https://github.com/autor",
  "repository": "https://github.com/autor/indexly-plugin-ejemplo",
  "license": "MIT",
  "isDesktopOnly": true,
  "main": "main.js",
  "styles": "styles.css",
  "permissions": [
    "fs:read",
    "net:http",
    "process:spawn",
    "db:write"
  ],
  "hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "signature": "ed25519:3a89e902bbf1823908f9c08...",
  "sourceCommit": "0d6e7cf45a1b2c3d4e5f6789abcdef0123456789",
  "contributes": {
    "commands": [
      {
        "id": "abrir-panel",
        "name": "Abrir Panel Principal",
        "defaultShortcut": "Mod+Shift+P"
      }
    ],
    "views": [
      {
        "type": "mi-vista-custom",
        "name": "Vista de Inspección",
        "icon": "layout-grid"
      }
    ],
    "settings": [
      {
        "key": "endpointUrl",
        "title": "URL del Endpoint",
        "type": "string",
        "default": "https://api.ejemplo.com"
      }
    ]
  }
}
```

---

## 2. Definición de Campos

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `schemaVersion` | `number` | Sí | Versión del esquema del manifiesto. Actualmente `1`. |
| `id` | `string` | Sí | Identificador único en formato reverse-domain (`^[a-z0-9-]+(\.[a-z0-9-]+)+$`). |
| `name` | `string` | Sí | Nombre legible para humanos presentado en la UI y el Hub. |
| `version` | `string` | Sí | Versión SemVer válida (`MAJOR.MINOR.PATCH`). |
| `minHostVersion` | `string` | Sí | Versión mínima requerida de IndexLy Desktop para su ejecución. |
| `description` | `string` | Sí | Resumen conciso del propósito del plugin. |
| `author` | `string` | Sí | Nombre o seudónimo del creador. |
| `authorUrl` | `string` | No | Enlace web o perfil público del autor. |
| `repository` | `string` | No | Repositorio de código fuente (GitHub, GitLab, etc.). |
| `license` | `string` | Sí | Identificador SPDX de la licencia de software (p. ej., `MIT`, `Apache-2.0`). |
| `isDesktopOnly` | `boolean` | No | Indica si el plugin depende de APIs del sistema de escritorio (`app.native`). Por defecto `true`. |
| `main` | `string` | Sí | Ruta relativa al archivo bundle CommonJS (`main.js`). |
| `styles` | `string` | No | Ruta relativa al archivo CSS de estilos (`styles.css`). |
| `permissions` | `string[]` | No | Lista de capacidades declaradas con carácter informativo y de transparencia. |
| `hash` | `string` | No | Hash SHA-256 del archivo `main.js` para validación de integridad en la descarga. |
| `signature` | `string` | No | Firma digital Ed25519 generada por el autor o por el Hub (informativa). |
| `sourceCommit` | `string` | No | Hash de commit Git correspondiente al código fuente exacto para auditoría pública. |
| `contributes` | `object` | No | Declaración estática de comandos, vistas y ajustes para indexación previa a la carga. |

---

## 3. Catálogo Informativo de Permisos (`permissions`)

Los permisos declarados informan al usuario sobre el alcance técnico del plugin antes de su instalación:

- `fs:read`: Lectura de archivos y directorios del sistema de archivos local.
- `fs:write`: Creación y modificación de archivos locales fuera del directorio privado del plugin.
- `net:http`: Realización de solicitudes de red salientes (`fetch`, descargas).
- `net:listen`: Apertura de puertos TCP locales de escucha.
- `process:spawn`: Ejecución de procesos y comandos del sistema operativo (`spawn`, `exec`).
- `clipboard`: Acceso a lectura o escritura en el portapapeles del sistema.
- `notifications`: Envío de notificaciones nativas del sistema operativo.
- `tray`: Creación y control de iconos en la bandeja del sistema (System Tray).
- `shortcuts`: Registro de atajos de teclado globales a nivel de sistema operativo.
- `windows`: Creación y gestión de ventanas nativas auxiliares.
- `keychain`: Almacenamiento y recuperación de secretos en el llavero seguro nativo.
- `db:write`: Ejecución de sentencias de escritura sobre SQLite (`app.native.db.exec`). Permiso informativo que advierte que el plugin modificará la base de datos local directamente.

---

## 4. Grandfathering de Manifiestos Legacy (v1–v3)

Para garantizar la compatibilidad inmediata de extensiones existentes (ReadLy, Vistas, plugins en JS suelto):

1. **`schemaVersion` ausente:** Si un plugin cuenta con `manifest.json` pero no declara `schemaVersion`, el host le asigna `schemaVersion: 0` y lo procesa mediante el pipeline de normalización legacy.
2. **`capabilities` a `permissions`:** Si el manifiesto legacy incluye `capabilities: string[]`, el normalizador transfiere automáticamente sus valores al campo `permissions`.
3. **`minHostVersion` por defecto:** Si no se especifica `minHostVersion`, se asume `"0.1.0"` para permitir su ejecución sin advertencias bloqueantes.
4. **Cabeceras en comentarios (`/* IndexLy Plugin ... */`):** Si un archivo `.js` suelto se encuentra directamente en la carpeta de plugins y contiene cabecera de comentario con metadatos (`id: ...`, `name: ...`), el host extrae los campos y sintetiza en memoria un `PluginManifest` v1 virtual, garantizando su carga limpia a través de `app.legacy`.
