// src/components/MappingModal.tsx — Modal para ajustar nombre, mapeo y flags de una fuente
import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Source, SourceMappingInfo, MappingConfig } from '../types';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { Slot } from '../plugins/Slot';
import { Button, Field, Input, Modal, Select, Spinner, Switch } from '../ui';

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
    <Modal
      open={true}
      onClose={onClose}
      size="md"
      title="Ajustar fuente"
      description="Renombra la fuente y elige qué campo de tu archivo corresponde a cada rol."
      footer={
        <div className="mapping-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleApply}
            loading={saving}
            disabled={loading}
          >
            {saving ? 'Guardando...' : 'Aplicar'}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div style={{ padding: '36px', display: 'flex', justifyContent: 'center' }}>
          <Spinner size="md" label="Cargando campos del archivo..." />
        </div>
      ) : (
        <div className="mapping-fields" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Nombre de la fuente" htmlFor="map-name">
            <Input
              id="map-name"
              placeholder="Ej: Mis Juegos"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>

          <Field label="Título (obligatorio)" htmlFor="map-title">
            <Select
              id="map-title"
              value={titleKey}
              onChange={(e) => setTitleKey(e.target.value)}
              options={
                availableKeys.length === 0
                  ? [{ value: '', label: '(Sin campos disponibles)' }]
                  : availableKeys.map((k) => ({ value: k, label: k }))
              }
            />
          </Field>

          <Field label="Subtítulo (opcional)" htmlFor="map-subtitle">
            <Select
              id="map-subtitle"
              value={subtitleKey}
              onChange={(e) => setSubtitleKey(e.target.value)}
              options={[
                { value: '', label: '(ninguno)' },
                ...availableKeys.map((k) => ({ value: k, label: k })),
              ]}
            />
          </Field>

          <Field label="Enlace (opcional)" htmlFor="map-link">
            <Select
              id="map-link"
              value={linkKey}
              onChange={(e) => setLinkKey(e.target.value)}
              options={[
                { value: '', label: '(ninguno)' },
                ...availableKeys.map((k) => ({ value: k, label: k })),
              ]}
            />
          </Field>

          {/* Flags de plugins (ej: plugin Streaming) */}
          {registeredFlags.length > 0 && (
            <div id="map-flags" className="map-flags" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
              {registeredFlags.map((f) => {
                const isChecked = !!flags[f.id];
                return (
                  <div key={f.id} className="plx-flag-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                    <div className="plx-flag-txt">
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>{f.label}</span>
                      {f.hint && <small style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: '11px' }}>{f.hint}</small>}
                    </div>
                    <Switch
                      checked={isChecked}
                      onCheckedChange={(next) =>
                        setFlags((prev) => ({
                          ...prev,
                          [f.id]: next,
                        }))
                      }
                      label={f.label}
                    />
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

          <p className="mapping-hint" style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Vista previa: <span id="mapping-preview" style={{ fontWeight: 500, color: 'var(--color-text)' }}>{previewText}</span>
          </p>
        </div>
      )}
    </Modal>
  );
};
