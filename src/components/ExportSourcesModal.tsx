// src/components/ExportSourcesModal.tsx — Exportar las fuentes elegidas a un
// paquete de IndexLy (.json) que se puede volver a importar o compartir.
import React, { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Download, Folder, FolderOpen } from 'lucide-react';
import { Button, Callout, Checkbox, Modal } from '../ui';
import { Source } from '../types';

interface ExportSourcesModalProps {
  open: boolean;
  sources: Source[];
  onClose: () => void;
  showToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

type Group = { key: string; label: string; isPkg: boolean; items: Source[] };

function groupSources(sources: Source[]): Group[] {
  const groups: Group[] = [];
  const byPkg = new Map<string, Group>();
  for (const s of sources) {
    const slug = s.pkg?.slug;
    if (!slug) {
      groups.push({ key: s.id, label: s.name, isPkg: false, items: [s] });
      continue;
    }
    let g = byPkg.get(slug);
    if (!g) {
      g = { key: `pkg:${slug}`, label: s.pkg?.name || slug, isPkg: true, items: [] };
      byPkg.set(slug, g);
      groups.push(g);
    }
    g.items.push(s);
  }
  return groups;
}

export const ExportSourcesModal: React.FC<ExportSourcesModalProps> = ({ open, sources, onClose, showToast }) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.map((s) => s.id)));
  const [exporting, setExporting] = useState(false);
  const [lastPath, setLastPath] = useState<string | null>(null);

  const groups = useMemo(() => groupSources(sources), [sources]);
  const allIds = useMemo(() => sources.map((s) => s.id), [sources]);
  const chosen = sources.filter((s) => selected.has(s.id));
  const chosenItems = chosen.reduce((acc, s) => acc + s.count, 0);
  const allChecked = chosen.length === sources.length && sources.length > 0;

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const handleExport = async () => {
    setExporting(true);
    try {
      const path = await invoke<string>('export_sources', { ids: chosen.map((s) => s.id) });
      setLastPath(path);
      showToast(`Exportado: ${path.split(/[\\/]/).pop()}`, 'success');
    } catch (err) {
      showToast(`No se pudo exportar: ${err}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleClose = () => {
    setLastPath(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      title="Exportar fuentes"
      description="Se guardan como un paquete de IndexLy (.json) en tu carpeta de Descargas. Puedes volver a importarlo o compartirlo."
      footer={
        <div className="exp-footer">
          <span className="exp-footer__info">
            {chosen.length} {chosen.length === 1 ? 'fuente' : 'fuentes'} · {chosenItems.toLocaleString('es-ES')} elementos
          </span>
          <div className="exp-footer__actions">
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Cerrar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExport}
              disabled={chosen.length === 0}
              loading={exporting}
              iconLeft={!exporting ? <Download size={13} /> : undefined}
            >
              Exportar
            </Button>
          </div>
        </div>
      }
    >
      {sources.length === 0 ? (
        <Callout variant="info">Todavía no tienes fuentes que exportar.</Callout>
      ) : (
        <div className="exp-body">
          <div className="exp-all">
            <Checkbox label="Seleccionar todas" checked={allChecked} onChange={(e) => toggle(allIds, e.target.checked)} />
          </div>

          <div className="exp-list" role="group" aria-label="Fuentes a exportar">
            {groups.map((g) => {
              const ids = g.items.map((s) => s.id);
              const count = ids.filter((id) => selected.has(id)).length;
              if (!g.isPkg) {
                const s = g.items[0];
                return (
                  <label key={g.key} className="exp-row">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => toggle([s.id], e.target.checked)} />
                    <span className="exp-row__name">{s.name}</span>
                    <span className="exp-row__count">{s.count.toLocaleString('es-ES')}</span>
                  </label>
                );
              }
              return (
                <div key={g.key} className="exp-group">
                  <label className="exp-row exp-row--pkg">
                    <input
                      type="checkbox"
                      checked={count === ids.length}
                      ref={(el) => {
                        if (el) el.indeterminate = count > 0 && count < ids.length;
                      }}
                      onChange={(e) => toggle(ids, e.target.checked)}
                    />
                    <Folder size={13} className="exp-row__icon" aria-hidden="true" />
                    <span className="exp-row__name">{g.label}</span>
                    <span className="exp-row__count">
                      {count}/{ids.length}
                    </span>
                  </label>
                  {g.items.map((s) => (
                    <label key={s.id} className="exp-row exp-row--child">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => toggle([s.id], e.target.checked)} />
                      <span className="exp-row__name">{s.name.replace(new RegExp(`^${g.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[/\\\\:·-]\\s*`, 'i'), '')}</span>
                      <span className="exp-row__count">{s.count.toLocaleString('es-ES')}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>

          {lastPath && (
            <div className="exp-done">
              <span title={lastPath}>Guardado en {lastPath}</span>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<FolderOpen size={13} />}
                onClick={() => revealItemInDir(lastPath).catch((e) => showToast(`No se pudo abrir la carpeta: ${e}`, 'error'))}
              >
                Mostrar en carpeta
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
