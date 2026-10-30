# Reglas de Diseño de la API de Plugins de IndexLy Desktop

Este documento contiene las normas arquitectónicas y de ingeniería de obligatorio cumplimiento para el diseño, implementación y mantenimiento de la **API de Plugins de IndexLy Desktop**. Cualquier contribución al núcleo de extensiones debe satisfacer estrictamente estos principios.

---

## 1. Los 10 Principios de Diseño Obligatorios

### Regla 1: Un solo objeto raíz (`app`)
- **Principio:** Toda la funcionalidad del host se expone a través de un único objeto `app`. No existen variables globales dispersas (`window.IndexLyCore`, `window.myUtils`, etc.).
- **HACER:**
  ```ts
  const sources = await this.app.library.getSources();
  this.app.workspace.openSpotlight();
  ```
- **NO HACER:**
  ```ts
  const sources = await window.__TAURI_INTERNALS__.invoke('get_sources');
  const items = await window.IndexLyGlobals.fetch();
  ```

---

### Regla 2: Todo registro es reversible
- **Principio:** Cualquier entidad registrada por un plugin (comandos, vistas, iconos de ribbon, items de status bar, listeners de eventos, atajos de teclado o intervalos) debe limpiarse de forma automática cuando el plugin se descarga.
- **Mecanismo:** La clase base `Plugin` recopila cada registro mediante `this.register*()` o `this.add*()` y ejecuta su desregistro en orden inverso (LIFO) en `onunload()`.
- **HACER:**
  ```ts
  export default class MyPlugin extends Plugin {
    async onload() {
      this.addCommand({
        id: 'open-my-view',
        name: 'Abrir Mi Vista',
        callback: () => this.openView()
      });

      this.registerDomEvent(window, 'resize', () => this.handleResize());
      this.registerInterval(window.setInterval(() => this.sync(), 60000));
    }
  }
  ```
- **NO HACER:**
  ```ts
  export default class MyPlugin extends Plugin {
    async onload() {
      // PELIGRO: Listener huérfano tras la descarga del plugin
      window.addEventListener('resize', () => this.handleResize());
      setInterval(() => this.sync(), 60000);
    }
  }
  ```

---

### Regla 3: Ciclo de vida explícito con límites de tiempo
- **Principio:** Los puntos de entrada del plugin son únicamente `onload()` y `onunload()`. Ambos pueden ser asíncronos (`Promise<void>`), pero están sometidos a límites de tiempo rigurosos garantizados por el host.
- **Límites:**
  - `onload()`: Tiempo máximo de **10 segundos**. Si la promesa no se resuelve en este intervalo, la carga se aborta y el plugin se marca como fallido.
  - `onunload()`: Tiempo máximo de **5 segundos**. Debe ser estrictamente **idempotente** (poder ejecutarse múltiples veces consecutivas sin arrojar error).
- **HACER:**
  ```ts
  async onload() {
    await this.loadInitialConfig();
    this.setupViews();
  }

  async onunload() {
    await this.flushPendingWrites();
  }
  ```
- **NO HACER:**
  ```ts
  async onload() {
    // PELIGRO: Bucle infinito o promesa no resuelta que congela la carga
    await new Promise(() => {});
  }
  ```

---

### Regla 4: API aditiva para siempre
- **Principio:** Ningún método, propiedad o evento público existente se renombra, modifica incompatiblemente o elimina dentro de la serie `1.x`. Si un diseño previo queda obsoleto, se marca como `@deprecated` con un aviso que especifique la alternativa y una ventana de coexistencia garantizada de al menos 12 meses.
- **Regla de oro:** "Nunca cambiamos la semántica de algo existente; añadimos nuevas interfaces".

---

### Regla 5: Tipado de primera clase sin `any`
- **Principio:** La API pública se entrega acompañada del paquete de tipos `@indexly/plugin-api` (o `indexly.d.ts`).
- **Normas de TypeScript:**
  - Modo estricto activado (`strict: true`, `noUncheckedIndexedAccess: true`).
  - Queda prohibido el uso del tipo `any` en firmas de la API pública. Utilizar `unknown` con type guards, genéricos parametrizados o uniones discriminadas.
- **HACER:**
  ```ts
  get<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  on(event: 'source:added', callback: (source: Source) => void): EventRef;
  ```
- **NO HACER:**
  ```ts
  get(key: string): Promise<any>;
  on(event: string, callback: any): any;
  ```

---

### Regla 6: Máxima descubribilidad
- **Principio:** La API debe estar diseñada para que un desarrollador pueda construir un plugin funcional e intuitivo leyendo únicamente los archivos de definición de tipos (`.d.ts`) y tres ejemplos estándar de referencia.
- **Nombres consistentes:** Nombres de métodos en verbo imperativo (`addCommand`, `registerView`, `openSpotlight`, `getSources`).
- **Autocompletado predictivo:** Todo método debe incluir JSDoc explicativo con ejemplos breves embebidos.

---

### Regla 7: Fallo aislado
- **Principio:** Un error o excepción no capturada dentro de un plugin no debe propagarse al hilo principal de la aplicación ni romper las vistas del host.
- **Mecanismo:** El host envuelve cada callback de plugin (`safeCall`). Si un plugin genera excepciones de forma reiterada (más de 10 errores en 5 minutos), el host emite una notificación al usuario y ofrece desactivar temporalmente el plugin sin reiniciar el programa.

---

### Regla 8: Sin magia ni comportamiento oculto
- **Principio:** Los métodos realizan exactamente lo que su nombre y contrato indican. No se realizan mutaciones colaterales no documentadas en el estado global.
- **Transparencia:** Si un método interactúa con el disco o la red, el flujo debe ser explícito. No se realizan escrituras automáticas silenciosas en ubicaciones ajenas al directorio del plugin.

---

### Regla 9: Rendimiento predecible
- **Principio:** La API no realiza cómputo intensivo síncrono. Ningún callback síncrono del host o de plugins debe demorarse más de 16 ms para no degradar la tasa de 60 fps del hilo de la interfaz.
- **Tareas pesadas:** Las operaciones de lectura masiva o análisis se realizan en streaming (`app.search.queryStream`) con soporte de cancelación cooperativa (`AbortSignal`) o delegadas a procesos secundarios nativos (`app.native.process.spawn`).

---

### Regla 10: El host manda en el DOM que posee
- **Principio:** Los plugins nunca manipulan directamente nodos del DOM pertenecientes a los componentes esenciales del host (barra de búsqueda, panel lateral, árbol de ajustes).
- **Contenedores dedicados:** El host entrega al plugin un elemento `HTMLElement` contenedor aislado para montar su interfaz (vistas, modales o secciones). El plugin es dueño absoluto de los hijos de ese contenedor y debe destruirlos limpiamente al cerrar la vista.

---

## 2. Directrices Específicas por Capa

### 2.1 Inyección de UI
1. **Contenedores limpios:** Cuando se instancia una vista (`ItemView`) o un modal (`Modal`), el host provee `this.contentEl`. El plugin no debe adjuntar elementos a `document.body` excepto modales gestionados mediante `app.ui.Modal`.
2. **Estilos con variables de tema:** Todos los estilos deben utilizar variables CSS estándar del host:
   ```css
   .my-plugin-card {
     background-color: var(--indexly-bg-secondary);
     color: var(--indexly-fg-primary);
     border: 1px solid var(--indexly-border);
     border-radius: var(--indexly-radius-md);
   }
   ```
3. **Inyección de estilos de plugin:** El archivo `styles.css` del plugin se asocia a la etiqueta `<style data-plugin-id="...">` y se purga de inmediato en `onunload()`.

### 2.2 Superficie Nativa (`app.native`)
1. **Escape Hatch documentado:** `app.native.invoke` permite interactuar con comandos Tauri no expuestos explícitamente, pero las extensiones deben preferir siempre los módulos tipados (`fs`, `process`, `net`, `db`, `shortcuts`).
2. **Acceso a Base de Datos:** `app.native.db` se encuentra restringida a solo lectura (`query`) por omisión. Toda mutación de esquema o inserción directa (`exec`) exige permiso expreso en el manifiesto y confirmación del usuario.
3. **Secretos e información sensible:** Nunca emplear `data.json` o `localStorage` para tokens de acceso, API keys o contraseñas. Utilizar exclusivamente `app.native.keychain`.

### 2.3 Manejo de Eventos y Reactividad
1. **EventRef:** Toda llamada a `app.events.on()` o suscripción reactiva devuelve un identificador de suscripción (`EventRef`) que puede pasarse a `this.registerEvent(ref)`.
2. **Namespacing:** Los eventos emitidos por extensiones deben seguir la convención `<plugin-id>:<nombre-evento>` para evitar colisiones con el bus central del host.

---

## 3. Checklist de Calidad para Autores y Revisores

Antes de dar por finalizada cualquier funcionalidad en la plataforma de extensiones:

- [ ] ¿Todos los métodos nuevos están reflejados en `indexly.d.ts`?
- [ ] ¿Existe una prueba que ejecute `onload()` y `onunload()` 100 veces y verifique que no quedan listeners, atajos ni temporizadores activos?
- [ ] ¿Todas las excepciones en callbacks de plugins están encapsuladas con `safeCall`?
- [ ] ¿Se garantiza la ausencia del tipo `any` en los tipos públicos exportados?
- [ ] ¿La interfaz respeta el snapshot generado por `@microsoft/api-extractor`?
- [ ] ¿Las operaciones asíncronas de larga duración admiten un `AbortSignal` para su cancelación?
