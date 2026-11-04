/**
 * @file src/ui/cn.ts
 * @description Concatenador de clases para la biblioteca de componentes de IndexLy.
 */

export type ClassValue = string | number | false | null | undefined;

/**
 * Une clases ignorando valores falsy. No deduplica: el orden importa y el
 * consumidor controla la precedencia.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
