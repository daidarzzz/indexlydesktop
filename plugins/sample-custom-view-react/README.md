# Custom View Plugin (`com.indexly.sample-custom-view-react`)

Plugin de referencia oficial para la creación de vistas personalizadas dentro del `Workspace` de IndexLy Desktop.

## Capacidades Demostradas

1. **Registro de Vistas (`this.registerView`)**:
   - Registra una vista con fábrica asociada que se monta dentro de un `WorkspaceLeaf`.
   - Limpieza automática: al descargar el plugin, el host cierra y desacopla todas las hojas abiertas de este tipo.

2. **Aislamiento del DOM**:
   - El plugin manipula exclusivamente el contenedor proporcionado (`leaf.containerEl`), sin ensuciar el documento global.

3. **Inyección de Estilos (`style.css`)**:
   - Estilos CSS inyectados y removidos limpiamente por el `PluginHost`.

4. **Suscripción Reactiva a Eventos (`this.registerEvent`)**:
   - Escucha reactiva de `app.library.on('source:added')` para actualizar la vista en tiempo real.
   - Desuscripción garantizada en orden LIFO.
