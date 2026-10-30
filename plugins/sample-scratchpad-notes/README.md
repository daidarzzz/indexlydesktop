# IndexLy Scratchpad & Notes Plugin

Plugin oficial de Bloc de Notas Rápido para **IndexLy Desktop v2.0**, construido sobre la API v1 de plataforma (`indexly`).

---

## Características

- 📝 **Editor Markdown fluido:** Títulos, etiquetas con `#` y área de texto para notas o fragmentos de código.
- 💾 **Persistencia atómica:** Guarda automáticamente todas las notas en el almacenamiento aislado (`data.json`) del plugin sin tocar la configuración global.
- ⚡ **Atajos globales de teclado:**
  - `Mod+Shift+N`: Abrir instantáneamente el Bloc de Notas.
- 📋 **Acceso al portapapeles nativo:** Copia el contenido markdown de cualquier nota al portapapeles del sistema operativo usando `app.native.clipboard`.
- 📊 **Contador de palabras en tiempo real:** Barra de estado reactiva que muestra el número total de notas y palabras.
- 🔍 **Búsqueda contextual:** Permite buscar el título o contenido de una nota en el motor de texto completo (FTS5) de IndexLy con un solo clic.
- ⚙️ **Pestaña de configuración (SettingTab):** Opciones para habilitar o deshabilitar el contador de estado y personalizar la etiqueta por defecto.

---

## Estructura de Archivos

```
sample-scratchpad-notes/
├── manifest.json   # Manifiesto v1 con permisos informativos
├── main.js         # Lógica central del plugin en CommonJS
├── style.css       # Estilos visuales con el diseño oscuro de IndexLy
└── README.md       # Esta documentación
```

---

## APIs utilizadas

| API | Uso |
| :--- | :--- |
| `this.addCommand(...)` | Registra comandos con atajos de teclado en la paleta. |
| `this.registerView(...)` | Registra la vista de workspace `indexly-scratchpad-view`. |
| `this.addRibbonIcon(...)` | Añade un botón con icono en el Ribbon lateral. |
| `this.addStatusBarItem()` | Añade un elemento reactivo en la barra de estado inferior. |
| `this.addSettingTab(...)` | Integra una pestaña en el gestor de ajustes usando `Setting`. |
| `this.loadData() / saveData()` | Persiste y recupera el estado de notas en disco. |
| `this.registerInterval(...)` | Temporizador periódico con desregistro LIFO garantizado. |
| `app.native.clipboard` | Lectura y escritura en el portapapeles nativo. |
| `app.search.query(...)` | Consultas directas al motor FTS5 de IndexLy. |
| `new Notice(...)` | Notificaciones flotantes tipo toast. |
