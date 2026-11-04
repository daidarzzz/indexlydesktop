// src/components/PluginModal.tsx — Gestor de plugins, extensiones y ajustes personalizados
import React, { useEffect, useRef, useState } from 'react';
import { LoadedPlugin, PluginSettingSchema } from '../types';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { pluginHost } from '../plugins/host/PluginHost';
import { safeModeManager } from '../plugins/host/SafeMode';
import {
  X,
  Puzzle,
  ShieldAlert,
  ShieldCheck,
  Check,
  RefreshCw,
  Settings2,
  ArrowLeft,
  Sliders,
  RotateCcw,
} from 'lucide-react';
import { Badge, Button, Callout, EmptyState, IconButton, Switch } from '../ui';

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
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: selectedPlugin ? '640px' : '1080px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {selectedPlugin ? (
              <IconButton
                label="Volver a la lista de plugins"
                size="sm"
                onClick={() => setSelectedPlugin(null)}
                style={{ color: 'var(--color-primary)' }}
              >
                <ArrowLeft size={18} />
              </IconButton>
            ) : (
              <Puzzle size={18} color="var(--color-primary)" />
            )}
            <h3>
              {selectedPlugin ? `Ajustes: ${selectedPlugin.manifest.name}` : 'Gestor de Extensiones y Plugins'}
            </h3>
          </div>
          <IconButton label="Cerrar modal" size="sm" className="modal-close" onClick={handleExit}>
            <X size={18} />
          </IconButton>
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
                  <Badge variant="success">✓ {savedNotice}</Badge>
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
                            <Switch
                              checked={!!val}
                              onCheckedChange={(next) => handleUpdateSetting(field.id, next)}
                              label={field.label}
                              title={val ? 'Desactivar opción' : 'Activar opción'}
                            />
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
                <EmptyState
                  icon={<Sliders size={26} />}
                  title="Este plugin no expone ajustes configurables"
                  description="Funciona de forma automática con su configuración predeterminada."
                />
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
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<RotateCcw size={12} />}
                    onClick={handleResetDefaults}
                  >
                    Restaurar por defecto
                  </Button>
                ) : (
                  <div />
                )}

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setSelectedPlugin(null)}
                >
                  Listo
                </Button>
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
                Habilita extensiones para enriquecer IndexLy con acciones, chips, filtros y vistas personalizadas.
              </p>

              {/* Banner de Modo Seguro */}
              {isSafe && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    marginBottom: '14px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '10px',
                    color: '#ef4444',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldAlert size={16} />
                    <span style={{ fontSize: '12px', fontWeight: 500 }}>
                      Modo Seguro activo tras cierres inesperados. Todos los plugins están en pausa.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      safeModeManager.resetSafeMode();
                      setIsSafe(false);
                      setHasChanges(true);
                    }}
                    style={{
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '6px',
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
                <Switch
                  checked={isRestricted}
                  onCheckedChange={(next) => {
                    safeModeManager.setRestrictedMode(next);
                    setIsRestricted(next);
                    setHasChanges(true);
                  }}
                  label="Modo Restringido"
                  title={isRestricted ? 'Desactivar Modo Restringido' : 'Activar Modo Restringido'}
                />
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

              <div className="plugin-grid">
                {plugins.map((p) => {
                  const { manifest } = p;
                  const schema = getPluginEffectiveSchema(p);
                  const modernTab = (pluginHost.app.settings as any)?.getTabs?.()?.find(
                    (t: any) => t?.plugin?.manifest?.id === manifest.id
                  );
                  const hasCustomSettings = !!pluginRegistry.getCustomSettingsRenderer(manifest.id) || !!modernTab;
                  const hasConfig = schema.length > 0 || hasCustomSettings;
                  const pendingPermissions = manifest.pendingPermissions || [];

                  return (
                    <article
                      key={manifest.id}
                      className={`plugin-card ${manifest.enabled ? '' : 'is-disabled'}`}
                    >
                      <header className="plugin-card__head">
                        <div className="plugin-card__avatar" aria-hidden="true">
                          {manifest.name.charAt(0).toUpperCase()}
                        </div>
                        <Switch
                          checked={manifest.enabled}
                          onCheckedChange={(next) => onTogglePlugin(manifest.id, next)}
                          label={manifest.enabled ? 'Deshabilitar plugin' : 'Habilitar plugin'}
                          title={manifest.enabled ? 'Deshabilitar plugin' : 'Habilitar plugin'}
                        />
                      </header>

                      <div className="plugin-card__title">
                        <strong title={manifest.name}>{manifest.name}</strong>
                        <Badge mono>v{manifest.version}</Badge>
                      </div>

                      <p className="plugin-card__desc" title={manifest.description}>
                        {manifest.description}
                      </p>

                      {(manifest.permissions || []).length > 0 && (
                        <div className="plugin-card__perms" aria-label="Permisos">
                          <ShieldCheck size={11} />
                          {(manifest.permissions || []).map((perm) => (
                            <Badge key={perm} variant="primary" mono>
                              {perm}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {pendingPermissions.length > 0 && (
                        <Callout variant="warning" icon={<ShieldAlert size={14} />}>
                          <strong>Permisos nuevos:</strong>{' '}
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{pendingPermissions.join(', ')}</span>
                        </Callout>
                      )}

                      <footer className="plugin-card__foot">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!hasConfig}
                          onClick={() => setSelectedPlugin(p)}
                          title={hasConfig ? `Configurar ajustes de ${manifest.name}` : 'Este plugin no declara opciones configurables'}
                          iconLeft={<Settings2 size={13} />}
                        >
                          Ajustes
                        </Button>
                        <IconButton
                          label={`Recargar ${manifest.name} en caliente (Dev Mode)`}
                          size="sm"
                          variant="secondary"
                          disabled={reloadingId === manifest.id || !manifest.enabled}
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
                        >
                          <RotateCcw size={13} className={reloadingId === manifest.id ? 'animate-spin' : ''} />
                        </IconButton>
                      </footer>
                    </article>
                  );
                })}
              </div>

              <Callout variant="warning" style={{ marginTop: '16px' }}>
                <strong>Los permisos son declarativos.</strong> Sirven para transparencia y consentimiento, pero no
                constituyen un sandbox: un plugin activo se ejecuta con los privilegios de la aplicación.
              </Callout>

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
                <Button
                  variant={hasChanges ? 'primary' : 'secondary'}
                  onClick={handleExit}
                >
                  {hasChanges ? 'Aplicar y salir' : 'Cerrar'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
