/**
 * @file src/plugins/manifest/validator.ts
 * @description Validador de manifiestos v1, grandfathering de extensiones legacy y cálculo de diferencias de permisos.
 */

import { PluginManifest } from '../types';
import { ValidationError } from '../api/errors';

/** Permisos reconocidos formalmente en el ecosistema IndexLy */
export const KNOWN_PERMISSIONS = [
  'fs:read',
  'fs:write',
  'process:exec',
  'network',
  'clipboard',
  'db:write',
  'shortcuts',
  'windows',
  'keychain',
] as const;

export type KnownPermission = typeof KNOWN_PERMISSIONS[number];

/** Resultado del análisis de diferencias de permisos entre versiones */
export interface PermissionDiff {
  readonly added: string[];
  readonly removed: string[];
  readonly unchanged: string[];
  readonly hasElevation: boolean;
}

/**
 * Valida un manifiesto de plugin v1 y aplica grandfathering si proviene de formatos legacy.
 * @param raw Objeto de manifiesto sin tipar
 * @returns Manifiesto formalmente validado y normalizado
 * @throws ValidationError si el manifiesto viola el contrato de compatibilidad
 */
export function validateAndNormalizeManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('El manifiesto debe ser un objeto JSON válido');
  }

  const obj = raw as Record<string, unknown>;

  // 1. Identificador único (id)
  let id = typeof obj.id === 'string' ? obj.id.trim() : '';
  if (!id) {
    throw new ValidationError('El campo "id" es obligatorio en el manifiesto');
  }

  // Grandfathering para plugins legacy incorporados (ej. "vistas", "readly", "spotlight")
  const isLegacyId = /^[a-z0-9_-]+$/i.test(id) && !id.includes('.');
  if (!isLegacyId) {
    // Para plugins de terceros modernos v1, requerir notación de dominio inverso
    const idRegex = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/i;
    if (!idRegex.test(id)) {
      throw new ValidationError(
        `El id de plugin '${id}' no cumple con el formato de dominio inverso (ej. 'com.autor.mi-plugin')`,
        'ERR_MANIFEST_INVALID_ID',
        id
      );
    }
  }

  // 2. Nombre descriptivo
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : id;

  // 3. Versión SemVer
  let version = typeof obj.version === 'string' ? obj.version.trim() : '0.1.0';
  const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
  if (!semverRegex.test(version)) {
    // Normalizar si es versión simple (ej: "1" o "1.0" -> "1.0.0")
    if (/^\d+$/.test(version)) {
      version = `${version}.0.0`;
    } else if (/^\d+\.\d+$/.test(version)) {
      version = `${version}.0`;
    } else {
      version = '0.1.0';
    }
  }

  // 4. Versión mínima del host
  const minHostVersion = typeof obj.minHostVersion === 'string' ? obj.minHostVersion.trim() : '0.1.0';

  // 5. Descripción y autor
  const description = typeof obj.description === 'string' ? obj.description.trim() : '';
  const author = typeof obj.author === 'string' ? obj.author.trim() : 'Comunidad';

  // 6. Permisos informativos
  let permissions: string[] = [];
  if (Array.isArray(obj.permissions)) {
    permissions = obj.permissions.filter((p): p is string => typeof p === 'string');
  }

  // 7. Hash y firma criptográfica
  const hash = typeof obj.hash === 'string' ? obj.hash.trim() : '';
  const signature = typeof obj.signature === 'string' ? obj.signature.trim() : undefined;
  const sourceCommit = typeof obj.sourceCommit === 'string' ? obj.sourceCommit.trim() : undefined;

  // 8. Estado enabled
  const enabled = obj.enabled !== false;

  return {
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
    id,
    name,
    version,
    minHostVersion,
    description,
    author,
    license: typeof obj.license === 'string' ? obj.license : 'MIT',
    main: typeof obj.main === 'string' ? obj.main : 'main.js',
    styles: typeof obj.styles === 'string' ? obj.styles : undefined,
    permissions,
    hash,
    signature,
    sourceCommit,
    enabled,
    entry_ui: typeof obj.entry_ui === 'string' ? obj.entry_ui : undefined,
    entry_backend: typeof obj.entry_backend === 'string' ? obj.entry_backend : undefined,
    settings: Array.isArray(obj.settings) ? obj.settings : undefined,
  };
}

/**
 * Calcula las diferencias de permisos declarados entre dos versiones de un plugin.
 * Alerta al usuario si la nueva versión requiere elevación de permisos (permisos añadidos).
 */
export function calculatePermissionDiff(oldPerms: string[] = [], newPerms: string[] = []): PermissionDiff {
  const oldSet = new Set(oldPerms);
  const newSet = new Set(newPerms);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const p of newSet) {
    if (oldSet.has(p)) {
      unchanged.push(p);
    } else {
      added.push(p);
    }
  }

  for (const p of oldSet) {
    if (!newSet.has(p)) {
      removed.push(p);
    }
  }

  return {
    added,
    removed,
    unchanged,
    hasElevation: added.length > 0,
  };
}
