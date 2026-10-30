# Reglas de Diseño de la API de Plugins de IndexLy Desktop

Este documento contiene las normas arquitectónicas y de ingeniería de obligatorio cumplimiento para el diseño, implementación y mantenimiento de la **API de Plugins de IndexLy Desktop**. Cualquier contribución al núcleo de extensiones debe satisfacer estrictamente estos principios.

---

## 1. Los 10 Principios de Diseño Obligatorios

### Regla 1: Un solo objeto raíz (`app`)
- **Principio:** Toda la funcionalidad del host se expone a través de un único objeto `app`. No existen variables globales dispersas (`window.IndexLyCore`, `window.myUtils`, etc.).
- **Aislamiento por Referencias Internas:** Se elimina el uso de `Object.freeze()` para evitar penalizaciones en optimizaciones monomórficas de V8 y fragilidad en grafos profundos. El host se aísla manteniendo su estado verdadero (registros de comandos, fuentes, hojas de vistas) en `Map` y `Set` privados del `PluginHost`. Aunque un plugin altere propiedades en su objeto `app` inyectado, el kernel despacha y gestiona a través de sus referencias privadas internas.
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

### Regla 2: Todo registro es reversible con Token de Generación
- **Principio:** Cualquier entidad registrada por un plugin (comandos, vistas, ribbon, status bar, listeners de eventos, atajos de teclado o intervalos) debe limpiarse de forma automática en orden inverso (LIFO) cuando el plugin se descarga.
- **Token de Generación (`generationId`):** Cada activación asigna un número de generación. Si una operación asíncrona intenta registrar algo cuando el plugin ya fue descargado o reiniciado, la llamada es descartada de inmediato al comprobar que su `generationId` ya no está activo.
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
      // PELIGRO: Listener e intervalo huérfanos tras la descarga
      window.addEventListener('resize', () => this.handleResize());
      setInterval(() => this.sync(), 60000);
    }
  }
  ```

---

### Regla 3: Ciclo de vida explícito y semántica realista de timeouts
- **Principio:** Los puntos de entrada son exclusivamente `onload()` y `onunload()`. Ambos pueden ser asíncronos (`Promise<void>`).
- **Semántica de Timeouts frente a V8:** En el hilo único de JavaScript, **un timer no puede interrumpir código síncrono bloqueante** (`while(true)`). Por tanto:
  - El código síncrono se supervisa con `performance.now()`. Si supera los 250 ms, se emite una advertencia de bloqueo.
  - Para promesas asíncronas: si `onload()` supera los **10 segundos**, el host aborta la espera, invalida el `generationId` del plugin, marca el plugin como `Failed` y ejecuta el descarte forzoso.
  - Si `onunload()` supera los **5 segundos**, el host interrumpe la espera y purga todos los recursos asociados de forma idempotente.
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
    // PELIGRO: Bucle síncrono infinito que congela el hilo de la UI
    while (true) {}
  }
  ```

---

### Regla 4: API aditiva para siempre
- **Principio:** Ningún método, propiedad o evento público existente se renombra, modifica de forma incompatible ni elimina dentro de la serie `1.x`. Si un diseño queda obsoleto, se marca como `@deprecated` con un aviso que especifique la alternativa y una ventana de coexistencia garantizada de al menos 12 meses.
- **Regla de oro:** "Nunca cambiamos la semántica de algo existente; añadimos nuevas interfaces".

---

### Regla 5: Tipado de primera clase sin `any`
- **Principio:** La API pública se entrega acompañada del paquete canónico `@indexly/plugin-api` (con `indexly.d.ts`).
- **Normas de TypeScript:**
  - Modo estricto activado (`strict: true`, `noUncheckedIndexedAccess: true`).
  - Queda prohibido el uso del tipo `any` en firmas públicas. Se utiliza `unknown` con type guards, genéricos parametrizados o uniones discriminadas.
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
- **Principio:** La API debe permitir construir un plugin útil leyendo únicamente los archivos `.d.ts` y tres ejemplos de referencia.
- **Nombres consistentes:** Nombres de métodos en verbo imperativo (`addCommand`, `registerView`, `openSpotlight`, `getSources`). JSDoc exhaustivo con ejemplos breves embebidos en cada método.

---

### Regla 7: Fallo aislado y atribución de errores globales
- **Principio:** Un error o excepción no capturada en un plugin nunca debe propagarse al hilo principal ni romper las vistas del host.
- **Atribución Precisa:**
  - Todo script se evalúa con `//# sourceURL=indexly-plugin://${manifest.id}/main.js`.
  - `window.onerror` y `window.onunhandledrejection` parsean la traza de pila (stack trace) para atribuir el error al plugin exacto responsable.
  - `safeCall` mantiene el contexto activo del plugin durante la ejecución de callbacks.
  - Si un plugin acumula más de 10 errores en 5 minutos, el host ofrece desactivarlo preventivamente.

---

### Regla 8: Sin magia ni permisos cosméticos
- **Principio:** Lo que el plugin puede hacer está documentado explícitamente; no hay comportamiento oculto ni sandbox ilusorio.
- **Transparencia en `db:write`:** `app.native.db.exec` no se bloquea en runtime. El campo `permissions: ["db:write"]` en el manifiesto informa al usuario durante la instalación y sirve para escaneos estáticos en el Hub.

---

### Regla 9: Rendimiento predecible
- **Principio:** La API no realiza cómputo intensivo síncrono en el hilo de renderizado. Los callbacks síncronos deben resolverse en menos de 16 ms.
- **Cancelación:** Las consultas masivas emplean streaming asíncrono (`app.search.queryStream`) con soporte obligatorio de `AbortSignal` cooperativo.

---

### Regla 10: El host manda en el DOM que posee
- **Principio:** Los plugins nunca manipulan directamente nodos del DOM pertenecientes al host.
- **Contenedores aislados:** El host entrega al plugin un elemento `HTMLElement` contenedor dedicado. El plugin monta su UI dentro y es responsable de su desmontaje sin alterar el DOM circundante.

---

## 2. Directrices Específicas por Capa

### 2.1 Superficie Nativa y Namespace Público de `invoke`
1. `app.native.invoke<T>(cmd, args)` queda formalmente restringido al namespace público de extensiones `plugin:*`. Queda prohibida la invocación de comandos internos privados (`core:*`, `__host_private_*`).
2. Para secretos, credenciales y tokens, es obligatorio el uso de `app.native.keychain`. Queda prohibido `localStorage` o `data.json` para información sensible.

### 2.2 React y Bundling (Decisiones P1)
1. **Formato de Bundle:** CommonJS empaquetado en `main.js`.
2. **React:** Si el plugin utiliza React, empaqueta su propio runtime y monta su árbol mediante `createRoot(containerEl)` dentro del contenedor provisto por el host. El host no comparte su instancia de React para evitar discrepancias de versión.

### 2.3 Grandfathering de Plugins Legacy
1. Plugins con cabecera `/* IndexLy Plugin ... */` o manifiestos v0 sin `schemaVersion` son normalizados automáticamente en memoria sin emitir errores de carga.
2. `window.IndexLy` se mantiene como proxy hacia `app.legacy` con advertencias informativas de deprecación.

---

## 3. Checklist de Calidad para Autores y Revisores

- [ ] ¿Todos los métodos nuevos están reflejados en `indexly.d.ts` sin usar `any`?
- [ ] ¿Pasa la prueba de fugas instrumentada de 100 ciclos en `@indexly/plugin-test-kit`?
- [ ] ¿Todas las excepciones en callbacks están encapsuladas con `safeCall` y sourceURL virtual?
- [ ] ¿El manifiesto incluye `schemaVersion: 1`, `hash`, `signature` y `sourceCommit`?
- [ ] ¿Las operaciones asíncronas admiten cancelación cooperativa mediante `AbortSignal`?
