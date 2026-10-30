/**
 * @file src/plugins/host/generation.ts
 * @description Gestión de tokens de generación monótonamente crecientes para invalidar llamadas tardías de plugins zombis.
 */

/**
 * Gestor de tokens de generación por plugin.
 * Cada vez que un plugin es activado o reiniciado, se incrementa su `generationId`.
 * Cualquier llamada tardía de una instancia con `generationId` previo es detectada y descartada.
 */
export class GenerationManager {
  private _activeGenerations: Map<string, number> = new Map();
  private _globalCounter: number = 0;

  /**
   * Genera un nuevo token de generación activo para el plugin especificado.
   * Invalida de forma atómica cualquier token anterior.
   * @param pluginId Identificador del plugin
   * @returns El nuevo token de generación
   */
  public nextGeneration(pluginId: string): number {
    this._globalCounter++;
    this._activeGenerations.set(pluginId, this._globalCounter);
    return this._globalCounter;
  }

  /**
   * Obtiene el token de generación activo actual para un plugin.
   * @param pluginId Identificador del plugin
   * @returns El token activo, o 0 si no está activo
   */
  public getActiveGeneration(pluginId: string): number {
    return this._activeGenerations.get(pluginId) || 0;
  }

  /**
   * Comprueba si un token de generación específico continúa siendo el activo para el plugin.
   * @param pluginId Identificador del plugin
   * @param token Token a verificar
   */
  public isValid(pluginId: string, token: number): boolean {
    if (!token || token <= 0) return false;
    const current = this._activeGenerations.get(pluginId);
    return current === token;
  }

  /**
   * Invalida el token del plugin al descargarse o sufrir timeout.
   * @param pluginId Identificador del plugin
   */
  public invalidate(pluginId: string): void {
    this._activeGenerations.delete(pluginId);
  }

  /**
   * Limpia todos los tokens de generación (usado en tests y reinicios).
   */
  public clear(): void {
    this._activeGenerations.clear();
  }
}

export const generationManager = new GenerationManager();
