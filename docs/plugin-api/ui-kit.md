# Biblioteca de componentes de IndexLy (`app.ui.components`)

IndexLy expone su propia familia de componentes React. La app y los plugins
comparten la misma implementación, los mismos tokens y el mismo aspecto visual,
así que una vista de plugin no necesita reconstruir botones, tarjetas o modales
ni cargar su propio sistema de diseño.

La biblioteca se sirve desde el host:

```js
const { React, ui, app } = require('indexly');
```

- `ui` es el objeto completo de la biblioteca (`ui.Button`, `ui.Card`, …).
- `app.ui.components` es el mismo objeto, accesible desde la fachada `App`.
- `React` es la instancia del host. Los plugins no deben importar otra copia de
  React: usar la del host evita dos runtimes y hooks duplicados.
- `ui.mount` / `ui.unmount` montan y desmontan árboles React en un contenedor.

> Los permisos del manifiesto son declarativos y no constituyen un sandbox. La
> biblioteca de UI no cambia el modelo de confianza: un plugin sigue ejecutándose
> en el mismo contexto que el host.

## Montar una vista

```js
const { React, ui } = require('indexly');

const h = React.createElement;
const { Button, Card, CardBody, CardTitle, Stack } = ui;

function Panel({ items }) {
  return h(
    Stack,
    { gap: 3 },
    h(Card, null, h(CardBody, null, h(CardTitle, null, `Elementos: ${items.length}`))),
    h(Button, { variant: 'primary', onClick: () => console.log('ok') }, 'Actualizar'),
  );
}

class MyView extends View {
  async onOpen() {
    this.root = document.createElement('div');
    this.containerEl.appendChild(this.root);
    ui.mount(h(Panel, { items: [] }), this.root);
  }

  async onClose() {
    ui.unmount(this.root);
  }
}
```

Con JSX, el mismo código queda:

```jsx
import { React, ui } from 'indexly';

function Panel() {
  return (
    <ui.Stack gap={3}>
      <ui.Button variant="primary">Actualizar</ui.Button>
    </ui.Stack>
  );
}

ui.mount(<Panel />, container);
```

`mount(node, container)` acepta un elemento DOM o un selector CSS. Si se vuelve
a llamar con el mismo contenedor, actualiza el árbol sin recrear la raíz. Llamar
siempre a `unmount(container)` en `onClose` para liberar efectos y suscripciones.

## Componentes

### Acciones

| Componente | Props principales | Notas |
| --- | --- | --- |
| `Button` | `variant` (`primary`, `secondary`, `ghost`, `danger`), `size` (`sm`, `md`, `lg`), `loading`, `block`, `iconLeft`, `iconRight` | `type="button"` por defecto. |
| `IconButton` | `label` (obligatorio), `variant`, `size` | La etiqueta se usa como `aria-label` y `title`. |
| `Switch` | `checked`, `onCheckedChange`, `label` | `role="switch"` y `aria-checked`. |
| `Checkbox` | `label`, `description`, props nativas | Casilla nativa estilizada. |

### Formularios

| Componente | Props principales |
| --- | --- |
| `Field` | `label`, `description`, `error`, `required`, `htmlFor`, `children` |
| `Input` | `controlSize`, `invalid`, `leadingIcon`, `trailingIcon`, props nativas |
| `Textarea` | `invalid`, props nativas |
| `Select` | `options`, `placeholder`, `controlSize`, `invalid` |
| `SearchInput` | `value`, `onChange`, `shortcut`, `onClear` |

`Field` acepta un render prop para conectar accesibilidad automáticamente:

```jsx
<ui.Field label="Token" error={error}>
  {(control) => <ui.Input {...control} type="password" />}
</ui.Field>
```

### Presentación

| Componente | Props principales |
| --- | --- |
| `Badge` | `variant` (`neutral`, `primary`, `success`, `warning`, `danger`), `dot`, `mono` |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardBody`, `CardFooter` | `interactive`, `actions` en la cabecera |
| `Callout` | `variant`, `title`, `icon` |
| `EmptyState` | `icon`, `title`, `description`, `actions`, `hints`, `tone` |
| `Spinner` | `size`, `label` |
| `Kbd` | `keys` (`"Ctrl+K"`) o hijos |
| `Stat` | `label`, `value`, `hint` |
| `Divider` | `orientation` |
| `Skeleton` | `width`, `height`, `shape` (`line`, `block`, `circle`) |
| `List`, `ListItem` | `title`, `description`, `leading`, `trailing`, `interactive` |

### Navegación y layout

| Componente | Props principales |
| --- | --- |
| `Tabs` | `items` (`id`, `label`, `icon`, `count`, `trailing`, `disabled`), `value`, `onChange`, `variant` |
| `SegmentedControl` | Igual que `Tabs`, con `variant="segmented"` |
| `Modal` | `open`, `onClose`, `title`, `description`, `size`, `footer`, `closeOnOverlay`, `closeOnEscape` |
| `Stack` | `gap`, `align`, `justify` |
| `Inline` | `gap`, `align`, `justify`, `wrap` |
| `Grid` | `gap`, `columns`, `minItemWidth` |

`Modal` se renderiza en un portal, bloquea el scroll del documento, cierra con
Escape y mantiene el foco dentro del diálogo.

## Estilos y tokens

La biblioteca usa las variables CSS de `src/index.css` (`--color-*`, `--space-*`,
`--text-*`, `--radius-*`) y añade unas pocas propias con prefijo `--ix-*`. Todas
las clases usan el prefijo `.ix-` para no colisionar con los estilos históricos
de la aplicación.

Un plugin no debe redefinir `.ix-*`. Si necesita una variante, componga los
componentes o pase `className` y estilos propios en un contenedor aislado.

## Buenas prácticas

- Usa `React` y `ui` del host; no incluyas React en el bundle del plugin.
- Monta en el contenedor que el host te entrega y limpia en `onClose`.
- No manipules el DOM fuera de tu contenedor.
- No dependas de clases internas de la app (`nav-btn`, `action-btn`, `chip`):
  usa los componentes de la biblioteca.
- Mantén las etiquetas accesibles: `IconButton` exige `label`; los campos deben
  ir dentro de `Field` o tener su propio `label`.

## Compatibilidad legacy

La fachada `window.IndexLy.ui` expone también `components`, `mount` y `unmount`.
Los plugins legacy pueden seguir usando sus helpers DOM, pero la vía recomendada
para nuevas extensiones es React + `ui.mount`.

## Referencia

- Código: `src/ui/index.ts` (barrel y objeto `ui`), `src/ui/components/`.
- Estilos: `src/ui/ui.css`.
- Tipos: `UiApi` en `src/plugins/types/index.ts`.
