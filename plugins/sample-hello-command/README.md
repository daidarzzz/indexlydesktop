# Hello Command Plugin (`com.indexly.sample-hello-command`)

Plugin de referencia oficial para la arquitectura de plugins v1 de IndexLy Desktop.

## Capacidades Demostradas

1. **Ciclo de Vida Determinista (`onload` y `onunload`)**:
   - Inicialización async con límite de 10 segundos.
   - Limpieza garantizada sin fugas en orden inverso (LIFO).

2. **Registro Reversible de Comandos (`this.addCommand`)**:
   - Integración nativa con la paleta de comandos de IndexLy.
   - Se desregistra automáticamente al descargar el plugin.

3. **Elementos Visuales Reactivos**:
   - `this.addRibbonIcon`: Botón interactivo en la barra lateral con tooltip.
   - `this.addStatusBarItem`: Indicador persistente en la barra inferior.
   - `new Notice(...)`: Notificaciones emergentes tipo toast.

4. **Temporizadores Seguros (`this.registerInterval`)**:
   - Uso de `window.setInterval` con desmantelamiento automático.

5. **Persistencia de Estado Aislada (`this.loadData` / `this.saveData`)**:
   - Almacenamiento JSON en el directorio privado del plugin.

## Estructura de Archivos

```
sample-hello-command/
 ├── manifest.json   # Metadatos del plugin conforme a Manifest v1
 ├── main.js         # Código CommonJS ejecutable en runtime Obsidian-style
 └── README.md       # Documentación y guía de uso
```
