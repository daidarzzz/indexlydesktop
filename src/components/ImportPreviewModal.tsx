// src/components/ImportPreviewModal.tsx — Vista previa al importar un archivo:
// detecta el formato, enseña las primeras filas y deja elegir qué campo es el
// título, el subtítulo, el enlace y el tamaño antes de guardar nada.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, FileText, Magnet, Package, Table2 } from 'lucide-react';
import { Button, Callout, Checkbox, Field, Input, Modal, Select, Spinner } from '../ui';
import { ImportPreview, MappingConfig } from '../types';

export interface PendingImport {
  name: string;
  content: string;
}

interface ImportPreviewModalProps {
  file: PendingImport;
  /** Posición en la cola cuando se sueltan varios archivos (1-based). */
  position: number;
  total: number;
  onCancel: () => void;
  onSkip?: () => void;
  /** Importa con el nombre y el mapeo elegidos. */
  onConfirm: (name: string, mapping: MappingConfig | null) => Promise<void>;
}

const FORMAT_LABEL: Record<ImportPreview['format'], string> = {
  json: 'JSON',
  jsonl: 'JSON Lines',
  csv: 'CSV',
  tsv: 'TSV',
  text: 'Texto',
  envelope: 'Paquete IndexLy',
};

const DELIMITERS = [
  { value: ',', label: 'Coma ( , )' },
  { value: ';', label: 'Punto y coma ( ; )' },
  { value: '\\t', label: 'Tabulador' },
  { value: '|', label: 'Barra ( | )' },
];

type FieldId = 'titleKey' | 'subtitleKey' | 'linkKey' | 'sizeKey';

const FIELDS: Array<{ id: FieldId; label: string; required?: boolean; tag: string }> = [
  { id: 'titleKey', label: 'Título', required: true, tag: 'Título' },
  { id: 'subtitleKey', label: 'Subtítulo', tag: 'Subtítulo' },
  { id: 'linkKey', label: 'Enlace', tag: 'Enlace' },
  { id: 'sizeKey', label: 'Tamaño', tag: 'Tamaño' },
];

/** "juegos.csv" → "juegos" */
function stripExtension(name: string) {
  return name.replace(/\.(jsonl?|ndjson|csv|tsv|txt)(\.gz)?$/i, '').trim() || name;
}

export const ImportPreviewModal: React.FC<ImportPreviewModalProps> = ({
  file,
  position,
  total,
  onCancel,
  onSkip,
  onConfirm,
}) => {
  const [name, setName] = useState(() => stripExtension(file.name));
  // Lo que el usuario ha tocado; el resto lo propone el backend
  const [choice, setChoice] = useState<MappingConfig>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const requestId = useRef(0);

  // Al cambiar de archivo en la cola, empezar de cero
  useEffect(() => {
    setName(stripExtension(file.name));
    setChoice({});
    setPreview(null);
  }, [file]);

  // Recalcular la vista previa (con un pequeño margen al cambiar opciones)
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await invoke<ImportPreview>('preview_import', {
          name: file.name,
          content: file.content,
          mapping: Object.keys(choice).length ? choice : null,
        });
        if (id !== requestId.current) return;
        setPreview(res);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(String(err));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, preview ? 120 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, choice]);

  const mapping = preview?.mapping ?? {};
  const isEnvelope = preview?.format === 'envelope';
  const isText = preview?.format === 'text';
  const isDelimited = preview?.format === 'csv' || preview?.format === 'tsv';

  // Columna → campo asignado, para marcarlo en la tabla
  const assigned = useMemo(() => {
    const map = new Map<string, string>();
    FIELDS.forEach((f) => {
      const key = mapping[f.id];
      if (key) map.set(key, map.has(key) ? `${map.get(key)} · ${f.tag}` : f.tag);
    });
    return map;
  }, [mapping]);

  const sampleFor = (col: string) => {
    const idx = preview?.columns.indexOf(col) ?? -1;
    const v = idx >= 0 ? preview?.rows.find((r) => r[idx])?.[idx] : undefined;
    return v ? (v.length > 28 ? `${v.slice(0, 28)}…` : v) : '';
  };

  const options = useMemo(
    () =>
      (preview?.columns ?? []).map((c) => {
        const sample = sampleFor(c);
        return { value: c, label: sample ? `${c}  ·  ${sample}` : c };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview]
  );

  const setField = (id: FieldId, value: string) => setChoice((prev) => ({ ...prev, [id]: value }));

  const canImport = !!preview && preview.total > 0 && !importing && (isEnvelope || isText || !!mapping.titleKey);

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const finalMapping: MappingConfig | null = isEnvelope || isText ? null : preview.mapping;
      await onConfirm(isEnvelope ? file.name : name.trim() || file.name, finalMapping);
    } finally {
      setImporting(false);
    }
  };

  const FormatIcon = isEnvelope ? Package : isText ? FileText : Table2;

  return (
    <Modal
      open
      onClose={onCancel}
      size="xl"
      className="imp-modal"
      title={
        <span className="imp-title">
          <span className="imp-title__icon" aria-hidden="true">
            <FormatIcon size={16} />
          </span>
          <span className="imp-title__text">
            <span>Importar archivo</span>
            <small title={file.name}>{file.name}</small>
          </span>
        </span>
      }
      footer={
        <div className="imp-footer">
          <span className="imp-footer__info">
            {total > 1 && <span className="imp-queue">{position} de {total}</span>}
            {preview && (
              <>
                <span className="imp-format">{FORMAT_LABEL[preview.format]}</span>
                {preview.delimiter && <span className="imp-format">sep. {preview.delimiter === '\\t' ? 'tab' : preview.delimiter}</span>}
              </>
            )}
          </span>
          <div className="imp-footer__actions">
            {onSkip && (
              <Button variant="ghost" size="sm" onClick={onSkip} disabled={importing}>
                Saltar
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onCancel} disabled={importing}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleImport} disabled={!canImport} loading={importing}>
              {preview ? `Importar ${preview.total.toLocaleString('es-ES')} elementos` : 'Importar'}
            </Button>
          </div>
        </div>
      }
    >
      {!preview && loading && (
        <div className="imp-loading">
          <Spinner size="md" />
          <span>Analizando el archivo…</span>
        </div>
      )}

      {error && !preview && (
        <Callout variant="danger" title="No se pudo leer el archivo">
          {error}
        </Callout>
      )}

      {preview && (
        <div className={`imp-body ${loading ? 'is-refreshing' : ''}`}>
          {/* — Ajustes — */}
          {isEnvelope ? (
            <Callout variant="info" title="Paquete de IndexLy">
              Contiene {preview.envelopeSources} {preview.envelopeSources === 1 ? 'fuente' : 'fuentes'} con{' '}
              {preview.total.toLocaleString('es-ES')} elementos ya mapeados. Se importará tal cual.
            </Callout>
          ) : (
            <section className="imp-settings">
              <Field label="Nombre de la fuente" htmlFor="imp-name">
                <Input id="imp-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>

              {isDelimited && (
                <div className="imp-csv">
                  <Field label="Separador" htmlFor="imp-delim">
                    <Select
                      id="imp-delim"
                      value={preview.delimiter ?? ','}
                      options={DELIMITERS}
                      onChange={(e) => setChoice((prev) => ({ delimiter: e.target.value, hasHeader: prev.hasHeader }))}
                    />
                  </Field>
                  <Checkbox
                    label="La primera fila son los nombres de columna"
                    checked={preview.hasHeader}
                    onChange={(e) => setChoice((prev) => ({ delimiter: prev.delimiter, hasHeader: e.target.checked }))}
                  />
                </div>
              )}

              {isText ? (
                <p className="imp-hint">
                  Cada línea será un elemento. Si una línea contiene un enlace (<code>https://</code> o{' '}
                  <code>magnet:</code>), se separa automáticamente del título.
                </p>
              ) : (
                <div className="imp-fields">
                  {FIELDS.map((f) => (
                    <Field key={f.id} label={f.label} htmlFor={`imp-${f.id}`} required={f.required}>
                      <Select
                        id={`imp-${f.id}`}
                        value={mapping[f.id] ?? ''}
                        onChange={(e) => setField(f.id, e.target.value)}
                        invalid={f.required && !mapping[f.id]}
                      >
                        {!f.required && <option value="">— Ninguno —</option>}
                        {f.required && !mapping[f.id] && <option value="">Elige un campo…</option>}
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* — Datos originales — */}
          {!isEnvelope && preview.rows.length > 0 && (
            <section className="imp-section">
              <h4>
                Datos del archivo <span>primeras {Math.min(preview.rows.length, 5)} filas</span>
              </h4>
              <div className="imp-table-wrap">
                <table className="imp-table">
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c} className={assigned.has(c) ? 'is-mapped' : ''}>
                          <span className="imp-col">{c}</span>
                          {assigned.has(c) && <span className="imp-tag">{assigned.get(c)}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {preview.columns.map((c, j) => (
                          <td key={c} className={assigned.has(c) ? 'is-mapped' : ''} title={row[j]}>
                            {row[j] || <span className="imp-empty">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* — Resultado — */}
          <section className="imp-section">
            <h4>
              Así quedará <span>{preview.total.toLocaleString('es-ES')} elementos</span>
            </h4>
            {preview.items.length === 0 ? (
              <p className="imp-hint imp-hint--warn">
                Con esta configuración no sale ningún elemento. Prueba otro campo de título o separador.
              </p>
            ) : (
              <div className="imp-result">
                {preview.items.slice(0, 5).map((it) => {
                  const isMagnet = it.link?.startsWith('magnet:');
                  return (
                    <div key={it.id} className="imp-item">
                      <span className="imp-item__main">
                        <strong title={it.title}>{it.title}</strong>
                        {it.subtitle && <small title={it.subtitle}>{it.subtitle}</small>}
                      </span>
                      {it.file_size && <span className="imp-item__size">{it.file_size}</span>}
                      <span
                        className={`imp-item__link ${it.link ? 'has-link' : ''}`}
                        title={it.link || 'Sin enlace'}
                      >
                        {it.link ? (isMagnet ? <Magnet size={12} /> : <ExternalLink size={12} />) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
};
