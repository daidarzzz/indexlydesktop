/**
 * @file src/ui/mount.ts
 * @description Montaje de árboles React en contenedores DOM arbitrarios.
 * Pensado para plugins: el host presta su instancia de React y el plugin
 * monta componentes de la biblioteca sin bundler propio.
 */

import type React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

const roots = new WeakMap<Element, Root>();

function resolveContainer(container: Element | string): Element {
  const element =
    typeof container === 'string' ? document.querySelector(container) : container;
  if (!element) {
    throw new Error(
      `[IndexLy UI] No se encontró el contenedor "${String(container)}" para montar la vista.`,
    );
  }
  return element;
}

/**
 * Monta (o actualiza) un árbol React en un contenedor.
 * Llamar de nuevo con el mismo contenedor actualiza la vista sin recrear la raíz.
 */
export function mount(node: React.ReactNode, container: Element | string): Root {
  const element = resolveContainer(container);
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  try {
    flushSync(() => {
      root!.render(node);
    });
  } catch {
    root.render(node);
  }
  return root;
}

/** Desmonta la raíz React asociada a un contenedor, si existe. */
export function unmount(container: Element | string): void {
  const element = typeof container === 'string' ? document.querySelector(container) : container;
  if (!element) return;
  const root = roots.get(element);
  if (!root) return;
  try {
    flushSync(() => {
      root.unmount();
    });
  } catch {
    root.unmount();
  }
  roots.delete(element);
}
