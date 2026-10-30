// src/components/MappingModal.tsx — Modal para ajustar nombre, mapeo y flags de una fuente
import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Source, SourceMappingInfo, MappingConfig } from '../types';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { Slot } from '../plugins/Slot';

interface MappingModalProps {
  source: Source;
  onClose: () => void;
  onSaved: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

export const MappingModal: React.FC<MappingModalProps> = ({
  source,
  onClose,
  onSaved,
  showToast,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableKeys, setAvailableKeys] = useState<string[]>([]);
  const [sampleRaw, setSampleRaw] = useState<Record<string, any> | null>(null);

  const [name, setName] = useState(source.name);
  const [titleKey, setTitleKey] = useState<string>('');
  const [subtitleKey, setSubtitleKey] = useState<string>('');
  const [linkKey, setLinkKey] = useState<string>('');
  const [flags, setFlags] = useState<Record<string, boolean>>(source.flags || {});

  // Cargar información de mapeo desde SQLite / Tauri
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const info = await invoke<SourceMappingInfo>('get_source_mapping_info', { id: source.id });
        if (!mounted) return;

        const keys = info.available_keys || [];
        setAvailableKeys(keys);
        setSampleRaw(info.sample_raw || null);

        // Inicializar flags con los valores actuales y defaults de plugins
        const currentFlags: Record<string, boolean> = { ...(source.flags || {}) };
        pluginRegistry.getIndexFlags().forEach((f) => {
          if (currentFlags[f.id] === undefined && f.defaultValue) {
            currentFlags[f.id] = true;
          }
        });
        setFlags(currentFlags);

        // Heurísticas de autodetección si no hay mapping previo
        const lowerKeys = keys.map((k) => k.toLowerCase());
        const findKey = (candidates: string[]) => {
          for (const cand of candidates) {
            const idx = lowerKeys.findIndex((k) => k === cand || k.includes(cand));
            if (idx >= 0) return keys[idx];
          }
          return '';
        };

        const existingMapping = source.mapping;
        const initialTitle =
          existingMapping?.title_key ||
          findKey(['title', 'titulo', 'name', 'nombre']) ||
          keys[0] ||
          '';
        const initialSubtitle =
          existingMapping?.subtitle_key ||
          findKey(['subtitle', 'subtitulo', 'description', 'desc', 'category']) ||
          '';
        const initialLink =
          existingMapping?.link_key ||
          findKey(['link', 'enlace', 'url', 'uris', 'uri', 'magnet']) ||
          '';

        setTitleKey(initialTitle);
        setSubtitleKey(initialSubtitle);
        setLinkKey(initialLink);
      } catch (err: any) {
        console.error('[MappingModal] Error cargando info de mapeo:', err);
        showToast(`Error al cargar datos de mapeo: ${err.message || err}`, 'error');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [source.id]);

  // Cerrar al pulsar Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Cálculo en tiempo real de la vista previa
  const previewText = useMemo(() => {
    if (!sampleRaw || availableKeys.length === 0) {
      return `${source.count.toLocaleString('es-ES')} elementos`;
    }

    const sampleTitle = titleKey && sampleRaw[titleKey] !== undefined ? String(sampleRaw[titleKey]) : '';
    const hasLink = !!(linkKey && sampleRaw[linkKey]);

    const titleStr = sampleTitle ? ` · ej: "${sampleTitle}"` : '';
    const linkStr = hasLink ? ' · con enlace' : '';

    return `${source.count.toLocaleString('es-ES')} elementos${titleStr}${linkStr}`;
  }, [sampleRaw, availableKeys, titleKey, linkKey, source.count]);

  const handleApply = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      showToast('El nombre de la fuente no puede estar vacío', 'warning');
      return;
    }

    if (!titleKey) {
      showToast('Elige un campo para el Título (obligatorio)', 'warning');
      return;
    }

    setSaving(true);
    try {
      const mappingConfig: MappingConfig = {
        title_key: titleKey,
        subtitle_key: subtitleKey || null,
        link_key: linkKey || null,
      };

      const updatedSource = await invoke<Source>('update_source_mapping', {
        id: source.id,
        name: cleanName,
        mapping: mappingConfig,
        flags: Object.keys(flags).length > 0 ? flags : null,
      });

      pluginRegistry.emit('source:updated', { source: updatedSource });
      showToast('Mapeo actualizado', 'success');
      await onSaved();
      onClose();
    } catch (err: any) {
      console.error('[MappingModal] Error guardando mapeo:', err);
      showToast(`Error al guardar: ${err.message || err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const registeredFlags = pluginRegistry.getIndexFlags();

  return (
    <div
      id="mapping-modal"
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog mapping-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mapping-title"
      >
        <div className="modal-header mapping-header">
          <h4 id="mapping-title">Ajustar fuente</h4>
          <button
            type="button"
            className="mapping-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <p className="mapping-desc">
          Renombra la fuente y elige qué campo de tu archivo corresponde a cada rol.
        </p>

        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
            Cargando campos del archivo...
          </div>
        ) : (
          <div className="mapping-fields">
            <label className="mapping-label" htmlFor="map-name">
              Nombre de la fuente
              <input
                id="map-name"
                type="text"
                className="mapping-input"
                placeholder="Ej: Mis Juegos"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>

            <label className="mapping-label" htmlFor="map-title">
              Título (obligatorio)
              <select
                id="map-title"
                value={titleKey}
                onChange={(e) => setTitleKey(e.target.value)}
              >
                {availableKeys.length === 0 && <option value="">(Sin campos disponibles)</option>}
                {availableKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            <label className="mapping-label" htmlFor="map-subtitle">
              Subtítulo (opcional)
              <select
                id="map-subtitle"
                value={subtitleKey}
                onChange={(e) => setSubtitleKey(e.target.value)}
              >
                <option value="">(ninguno)</option>
                {availableKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            <label className="mapping-label" htmlFor="map-link">
              Enlace (opcional)
              <select
                id="map-link"
                value={linkKey}
                onChange={(e) => setLinkKey(e.target.value)}
              >
                <option value="">(ninguno)</option>
                {availableKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            {/* Flags de plugins (ej: plugin Streaming) */}
            {registeredFlags.length > 0 && (
              <div id="map-flags" className="map-flags">
                {registeredFlags.map((f) => {
                  const isChecked = !!flags[f.id];
                  return (
                    <div key={f.id} className="plx-flag-row">
                      <div className="plx-flag-txt">
                        <span>{f.label}</span>
                        {f.hint && <small>{f.hint}</small>}
                      </div>
                      <button
                        type="button"
                        className="index-switch"
                        role="switch"
                        aria-checked={isChecked}
                        aria-label={f.label}
                        onClick={() =>
                          setFlags((prev) => ({
                            ...prev,
                            [f.id]: !isChecked,
                          }))
                        }
                      >
                        <span className="knob" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Extensibilidad: Slot para que cualquier plugin agregue contenido al modal */}
            <Slot
              name="mapping_modal"
              context={{
                source,
                availableKeys,
                sampleRaw,
                mapping: { titleKey, subtitleKey, linkKey },
                flags,
                setFlags,
                setName,
              }}
            />
          </div>
        )}

        <p className="mapping-hint">
          Vista previa: <span id="mapping-preview">{previewText}</span>
        </p>

        <div className="mapping-actions">
          <button
            type="button"
            className="mapping-btn secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="mapping-btn primary"
            onClick={handleApply}
            disabled={saving || loading}
          >
            {saving ? 'Guardando...' : 'Aplicar'}
          </button>
        </div>
      </div>
    </div>
  );
};
