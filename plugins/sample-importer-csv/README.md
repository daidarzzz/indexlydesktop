# CSV Tabular Importer Plugin (`com.indexly.sample-importer-csv`)

Plugin de referencia oficial para la extensión del pipeline de importación (`app.importer`) en IndexLy Desktop.

## Capacidades Demostradas

1. **Extensión de Importadores (`app.importer.registerImporter`)**:
   - Registro de extensiones soportadas (`.csv`, `.tsv`) con función discriminadora `canHandle`.

2. **Acceso Nativo al Sistema de Archivos (`app.native.fs`)**:
   - Uso de `app.native.fs.readText(filePath)` sin limitaciones de sandbox.

3. **Cancelación Cooperativa con `AbortSignal`**:
   - Verificación continua de `opts.signal.aborted` para permitir al usuario cancelar importaciones pesadas sin bloqueos.

4. **Streaming de Progreso en Vivo (`app.events`)**:
   - Emisión de eventos `import:progress` hacia el bus reactivo del host para alimentar barras de progreso en la UI.
