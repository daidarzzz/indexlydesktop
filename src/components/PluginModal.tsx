// src/components/PluginModal.tsx — Gestor de plugins, extensiones y ajustes personalizados
import React, { useEffect, useRef, useState } from 'react';
import { LoadedPlugin, PluginSettingSchema } from '../types';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { pluginHost } from '../plugins/host/PluginHost';
import { safeModeManager } from '../plugins/host/SafeMode';
import {
  X,
  Puzzle,
  ShieldCheck,
  ShieldAlert,
  Check,
  RefreshCw,
  Settings2,
  ArrowLeft,
  Sliders,
  RotateCcw,
} from 'lucide-react';

interface PluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  plugins: LoadedPlugin[];
  onTogglePlugin: (id: string, enabled: boolean) => Promise<void>;
}

export const PluginModal: React.FC<PluginModalProps> = ({
  isOpen,
  onClose,
  plugins,
  onTogglePlugin,
}) => {
  const initialStatesRef = useRef<Record<string, boolean>>({});
  const wasOpenRef = useRef(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Estados de seguridad: Modo Restringido y Modo Seguro
  const [isRestricted, setIsRestricted] = useState(safeModeManager.isRestrictedModeActive);
  const [isSafe, setIsSafe] = useState(safeModeManager.isSafeModeActive);
  const [reloadingId, setReloadingId] = useState<string | null>(null);

  // Plugin seleccionado para ver sus ajustes
  const [selectedPlugin, setSelectedPlugin] = useState<LoadedPlugin | null>(null);
  const [settingsValues, setSettingsValues] = useState<Record<string, any>>({});
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Al abrir el modal, capturar el estado inicial de cada plugin
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const states: Record<string, boolean> = {};
      plugins.forEach((p) => {
        states[p.manifest.id] = p.manifest.enabled;
      });
      initialStatesRef.current = states;
      setHasChanges(false);
      setSelectedPlugin(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, plugins]);

  // Comprobar si algún plugin difiere de su estado inicial al abrir el modal
  useEffect(() => {
    if (!isOpen) return;
    const changed = plugins.some((p) => {
      const initial = initialStatesRef.current[p.manifest.id];
      return initial !== undefined && initial !== p.manifest.enabled;
    });
    setHasChanges(changed);
  }, [plugins, isOpen]);

  // Helper para obtener el esquema de ajustes efectivo del plugin
  const getPluginEffectiveSchema = (p: LoadedPlugin | null): PluginSettingSchema[] => {
    if (!p) return [];
    const fromRegistry = pluginRegistry.getPluginSettingsSchema(p.manifest.id);
    if (fromRegistry && fromRegistry.length > 0) return fromRegistry;
    if (p.manifest.settings && Array.isArray(p.manifest.settings) && p.manifest.settings.length > 0) {
      return p.manifest.settings as PluginSettingSchema[];
    }
    return [];
  };

  // Cargar valores de configuración cuando se selecciona un plugin
  useEffect(() => {
    if (!selectedPlugin) {
      setSettingsValues({});
      return;
    }

    const pluginId = selectedPlugin.manifest.id;
    const schema = getPluginEffectiveSchema(selectedPlugin);

    const loadValues = async () => {
      const loaded: Record<string, any> = {};
      for (const field of schema) {
        loaded[field.id] = await pluginRegistry.getPluginSetting(pluginId, field.id, field.default);
      }
      setSettingsValues(loaded);
    };

    loadValues();
  }, [selectedPlugin]);

  const handleUpdateSetting = async (fieldId: string, value: any) => {
    if (!selectedPlugin) return;
    const pluginId = selectedPlugin.manifest.id;

    setSettingsValues((prev) => ({ ...prev, [fieldId]: value }));
    await pluginRegistry.setPluginSetting(pluginId, fieldId, value);

    setSavedNotice('Ajuste guardado');
    setTimeout(() => setSavedNotice(null), 1800);
  };

  const handleResetDefaults = async () => {
    if (!selectedPlugin) return;
    const pluginId = selectedPlugin.manifest.id;
    const schema = pluginRegistry.getPluginSettingsSchema(pluginId);

    const defaults: Record<string, any> = {};
    for (const field of schema) {
      if (field.default !== undefined) {
        defaults[field.id] = field.default;
        await pluginRegistry.setPluginSetting(pluginId, field.id, field.default);
      }
    }
    setSettingsValues(defaults);
    setSavedNotice('Valores restaurados por defecto');
    setTimeout(() => setSavedNotice(null), 1800);
  };

  // Salir de la sección de plugins (solo recarga si hubo cambios reales en activación)
  const handleExit = () => {
    if (selectedPlugin) {
      setSelectedPlugin(null);
      return;
    }

    if (hasChanges) {
      window.location.reload();
    } else {
      onClose();
    }
  };

  // Soporte para tecla Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasChanges, selectedPlugin]);

  if (!isOpen) return null;

  const currentSchema: PluginSettingSchema[] = getPluginEffectiveSchema(selectedPlugin);
  const customSettingsRenderer = selectedPlugin
    ? pluginRegistry.getCustomSettingsRenderer(selectedPlugin.manifest.id)
    : null;
  const modernSettingTab = selectedPlugin
    ? (pluginHost.app.settings as any)?.getTabs?.()?.find(
        (t: any) => t?.plugin?.manifest?.id === selectedPlugin.manifest.id
      )
    : null;

  return (
    <div className="modal-overlay" onClick={handleExit}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {selectedPlugin ? (
              <button
                type="button"
                className="btn-icon"
                onClick={() => setSelectedPlugin(null)}
                title="Volver a la lista de plugins"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px',
                  marginRight: '2px',
                }}
              >
                <ArrowLeft size={18} />
              </button>
            ) : (
              <Puzzle size={18} color="var(--color-primary)" />
            )}
            <h3>
              {selectedPlugin ? `Ajustes: ${selectedPlugin.manifest.name}` : 'Gestor de Extensiones y Plugins'}
            </h3>
          </div>
          <button type="button" className="modal-close" onClick={handleExit} title="Cerrar modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* VISTA 1: PANEL DE AJUSTES DEL PLUGIN SELECCIONADO */}
          {selectedPlugin ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '12px',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    Personaliza las opciones y comportamiento de este plugin en tiempo real.
                  </span>
                </div>
                {savedNotice && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#22c55e',
                      background: 'rgba(34, 197, 94, 0.1)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 500,
                    }}
                  >
                    ✓ {savedNotice}
                  </span>
                )}
              </div>

              {/* Renderizador de ajustes custom si el plugin registró uno (Legacy o Modern PluginSettingTab) */}
              {(customSettingsRenderer || modernSettingTab) && (
                <div
                  ref={(el) => {
                    if (el && !el.dataset.rendered) {
                      el.dataset.rendered = 'true';
                      el.innerHTML = '';
                      if (modernSettingTab) {
                        try {
                          modernSettingTab.display();
                          el.appendChild(modernSettingTab.containerEl);
                        } catch (err) {
                          console.error('[Settings] Error en display de PluginSettingTab:', err);
                        }
                      } else if (customSettingsRenderer) {
                        try {
                          customSettingsRenderer(el);
                        } catch (err) {
                          console.error('[Settings] Error en render custom:', err);
                        }
                      }
                    }
                  }}
                />
              )}

              {/* Renderizador dinámico por esquema */}
              {!customSettingsRenderer && !modernSettingTab && currentSchema.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {currentSchema.map((field) => {
                    const val = settingsValues[field.id] ?? field.default;

                    return (
                      <div
                        key={field.id}
                        style={{
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '10px',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label
                            htmlFor={`setting-${field.id}`}
                            style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}
                          >
                            {field.label}
                          </label>

                          {field.type === 'boolean' ? (
                            <button
                              type="button"
                              className="index-switch"
                              role="switch"
                              aria-checked={!!val}
                              onClick={() => handleUpdateSetting(field.id, !val)}
                              title={val ? 'Desactivar opción' : 'Activar opción'}
                            >
                              <span className="knob" />
                            </button>
                          ) : field.type === 'number' ? (
                            <input
                              id={`setting-${field.id}`}
                              type="number"
                              min={field.min}
                              max={field.max}
                              value={val ?? 0}
                              onChange={(e) => handleUpdateSetting(field.id, Number(e.target.value))}
                              style={{
                                width: '80px',
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text)',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                fontSize: '13px',
                                outline: 'none',
                                textAlign: 'right',
                              }}
                            />
                          ) : field.type === 'select' ? (
                            <select
                              id={`setting-${field.id}`}
                              value={val ?? ''}
                              onChange={(e) => handleUpdateSetting(field.id, e.target.value)}
                              style={{
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text)',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '13px',
                                outline: 'none',
                              }}
                            >
                              {(field.options || []).map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : field.type === 'color' ? (
                            <input
                              id={`setting-${field.id}`}
                              type="color"
                              value={val ?? '#38bdf8'}
                              onChange={(e) => handleUpdateSetting(field.id, e.target.value)}
                              style={{
                                width: '36px',
                                height: '28px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                              }}
                            />
                          ) : (
                            <input
                              id={`setting-${field.id}`}
                              type={field.type === 'password' ? 'password' : 'text'}
                              value={val ?? ''}
                              onChange={(e) => handleUpdateSetting(field.id, e.target.value)}
                              style={{
                                width: '220px',
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text)',
                                padding: '5px 10px',
                                borderRadius: '6px',
                                fontSize: '13px',
                                outline: 'none',
                              }}
                            />
                          )}
                        </div>

                        {field.hint && (
                          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', lineHeight: '1.4' }}>
                            {field.hint}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Si el plugin aún no declara ajustes formales */}
              {!customSettingsRenderer && !modernSettingTab && currentSchema.length === 0 && (
                <div
                  style={{
                    padding: '24px 16px',
                    textAlign: 'center',
                    background: 'var(--color-surface)',
                    border: '1px dashed var(--color-border)',
                    borderRadius: '12px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <Sliders size={28} color="var(--color-text-tertiary)" style={{ margin: '0 auto 8px' }} />
                  <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>
                    Sin opciones configurables
                  </p>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                    Este plugin no requiere ajustes adicionales en su manifiesto o funciona de forma autónoma.
                  </span>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '10px',
                  paddingTop: '14px',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                {currentSchema.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleResetDefaults}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-tertiary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <RotateCcw size={12} />
                    Restaurar por defecto
                  </button>
                ) : (
                  <div />
                )}

                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setSelectedPlugin(null)}
                  style={{
                    padding: '7px 18px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    background: 'var(--color-primary)',
                    color: '#fff',
                    borderRadius: '8px',
                    fontWeight: 500,
                  }}
                >
                  Listo
                </button>
              </div>
            </div>
          ) : (
            /* VISTA 2: LISTA DE PLUGINS */
            <div>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--color-text-secondary)',
                  marginBottom: '14px',
                  lineHeight: '1.5',
                }}
              >
                Los plugins permiten extender la interfaz inyectando nuevas vistas, botones de acción, atajos y
                filtros personalizados.
              </p>

              {/* Alerta de Modo Seguro */}
              {isSafe && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    marginBottom: '14px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    color: '#ef4444',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldAlert size={16} />
                    <span><strong>Modo Seguro Activo:</strong> Se detectaron cierres inesperados previos. Extensiones pausadas.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      safeModeManager.resetSafeMode();
                      setIsSafe(false);
                    }}
                    style={{
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Restaurar
                  </button>
                </div>
              )}

              {/* Modo Restringido global */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  marginBottom: '14px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '10px',
                }}
              >
                <div>
                  <strong style={{ fontSize: '13px', color: 'var(--color-text)', display: 'block' }}>
                    Modo Restringido (Restricted Mode)
                  </strong>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    Desactiva extensiones comunitarias para máxima seguridad y auditoría.
                  </span>
                </div>
                <button
                  type="button"
                  className="index-switch"
                  role="switch"
                  aria-checked={isRestricted}
                  onClick={() => {
                    const next = !isRestricted;
                    safeModeManager.setRestrictedMode(next);
                    setIsRestricted(next);
                    setHasChanges(true);
                  }}
                  title={isRestricted ? 'Desactivar Modo Restringido' : 'Activar Modo Restringido'}
                >
                  <span className="knob" />
                </button>
              </div>

              {hasChanges && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '9px 12px',
                    marginBottom: '14px',
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#38bdf8',
                  }}
                >
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Cambios pendientes: la aplicación se recargará al salir para aplicarlos limpiamente.</span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {plugins.map((p) => {
                  const { manifest } = p;
                  const schema = getPluginEffectiveSchema(p);
                  const modernTab = (pluginHost.app.settings as any)?.getTabs?.()?.find(
                    (t: any) => t?.plugin?.manifest?.id === manifest.id
                  );
                  const hasCustomSettings = !!pluginRegistry.getCustomSettingsRenderer(manifest.id) || !!modernTab;
                  const hasConfig = schema.length > 0 || hasCustomSettings;

                  return (
                    <div
                      key={manifest.id}
                      style={{
                        background: 'var(--color-surface-hover)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ fontSize: '14px', color: 'var(--color-text)' }}>{manifest.name}</strong>
                            <span
                              style={{
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-text-tertiary)',
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                padding: '1px 6px',
                                borderRadius: '999px',
                              }}
                            >
                              v{manifest.version}
                            </span>
                          </div>
                          <p
                            style={{
                              fontSize: '12px',
                              color: 'var(--color-text-secondary)',
                              marginTop: '4px',
                              lineHeight: '1.4',
                            }}
                          >
                            {manifest.description}
                          </p>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Botón Recargar en caliente (Dev Mode) */}
                          <button
                            type="button"
                            onClick={async () => {
                              setReloadingId(manifest.id);
                              try {
                                if ((window as any).__pluginHost?.reloadPlugin) {
                                  await (window as any).__pluginHost.reloadPlugin(manifest.id);
                                } else {
                                  await onTogglePlugin(manifest.id, false);
                                  await onTogglePlugin(manifest.id, true);
                                }
                              } finally {
                                setTimeout(() => setReloadingId(null), 500);
                              }
                            }}
                            title={`Recargar ${manifest.name} en caliente (Dev Mode)`}
                            style={{
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid var(--color-border)',
                              color: 'var(--color-text-secondary)',
                              borderRadius: '7px',
                              padding: '5px 8px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontWeight: 500,
                            }}
                          >
                            <RotateCcw size={12} className={reloadingId === manifest.id ? 'animate-spin' : ''} />
                            <span>Recargar</span>
                          </button>

                          {/* Botón de Ajustes */}
                          <button
                            type="button"
                            onClick={() => setSelectedPlugin(p)}
                            title={`Configurar ajustes de ${manifest.name}`}
                            style={{
                              background: hasConfig ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                              border: `1px solid ${hasConfig ? 'rgba(56, 189, 248, 0.25)' : 'var(--color-border)'}`,
                              color: hasConfig ? '#38bdf8' : 'var(--color-text-secondary)',
                              borderRadius: '7px',
                              padding: '5px 9px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              fontWeight: 500,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Settings2 size={13} />
                            <span>Ajustes</span>
                          </button>

                          <button
                            type="button"
                            className="index-switch"
                            role="switch"
                            aria-checked={manifest.enabled}
                            onClick={() => onTogglePlugin(manifest.id, !manifest.enabled)}
                            title={manifest.enabled ? 'Deshabilitar plugin' : 'Habilitar plugin'}
                          >
                            <span className="knob" />
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--color-text-tertiary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <ShieldCheck size={11} />
                          Permisos:
                        </span>
                        {(manifest.permissions || manifest.capabilities || []).map((perm) => (
                          <span
                            key={perm}
                            style={{
                              fontSize: '10px',
                              fontFamily: 'var(--font-mono)',
                              color: '#38bdf8',
                              background: 'rgba(14, 165, 233, 0.08)',
                              border: '1px solid rgba(14, 165, 233, 0.2)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {perm}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  border: '1px dashed var(--color-border)',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.015)',
                  fontSize: '11px',
                  color: 'var(--color-text-tertiary)',
                  lineHeight: '1.5',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: 'var(--color-text-secondary)',
                    marginBottom: '4px',
                    fontWeight: 500,
                  }}
                >
                  <Check size={12} color="#22c55e" />
                  <span>Ajustes automáticos y almacenamiento aislado</span>
                </div>
                Cualquier opción configurada en los ajustes se guarda automáticamente en el almacenamiento local
                aislado del plugin y se sincroniza en tiempo real sin requerir reinicios.
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: '18px',
                  paddingTop: '14px',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleExit}
                  style={{
                    padding: '8px 18px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    background: hasChanges ? 'var(--color-primary)' : 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: hasChanges ? '#fff' : 'var(--color-text)',
                    borderRadius: '8px',
                    fontWeight: 500,
                  }}
                >
                  {hasChanges ? 'Aplicar y salir' : 'Cerrar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
