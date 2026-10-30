// src/components/ResultsView.tsx — Renderizado de resultados (Lista y Cuadrícula con slots)
import React, { useEffect, useState } from 'react';
import { UnifiedItem } from '../types';
import { Slot } from '../plugins/Slot';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { ExternalLink, SearchX, FolderOpen } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';

interface ResultsViewProps {
  items: UnifiedItem[];
  total: number;
  totalItemsCount: number;
  activeSourcesCount: number;
  tookMs: number;
  viewMode: 'list' | 'grid';
  onLoadMore?: () => void;
  hasMore?: boolean;
}

function getCardGradient(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 70%, 25%), hsl(${h2}, 80%, 15%))`;
}

export const ResultsView: React.FC<ResultsViewProps> = ({
  items,
  total,
  totalItemsCount,
  activeSourcesCount,
  tookMs,
  viewMode,
  onLoadMore,
  hasMore,
}) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    return pluginRegistry.subscribe(() => setTick((t) => t + 1));
  }, []);

  const activeCustomView = pluginRegistry.getActiveView();

  if (activeSourcesCount === 0 && items.length === 0) {
    return (
      <div className="empty-results-box" style={{ marginTop: '28px' }}>
        <div className="empty-results-icon-wrap warning">
          <FolderOpen size={24} className="empty-results-icon" />
        </div>
        <h3 className="empty-results-title">No hay fuentes activas</h3>
        <p className="empty-results-desc">
          Activa o añade al menos una fuente en el gestor superior para comenzar a buscar en tus índices.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty-results-box" style={{ marginTop: '28px' }}>
        <div className="empty-results-icon-wrap">
          <SearchX size={26} className="empty-results-icon" />
        </div>
        <h3 className="empty-results-title">Sin resultados</h3>
        <p className="empty-results-desc">
          No se encontraron coincidencias para tu búsqueda.
        </p>
        <div className="empty-results-hints">
          <span className="hint-pill">Revisa la ortografía</span>
          <span className="hint-pill">Prueba términos más generales</span>
          <span className="hint-pill">Comprueba filtros activos</span>
        </div>
      </div>
    );
  }

  if (activeCustomView) {
    return (
      <div
        id="results"
        className="results plx-custom-view-container"
        style={{ marginTop: '20px' }}
        ref={(el) => {
          if (el) {
            el.innerHTML = '';
            try {
              activeCustomView.render(el, { items, total, viewMode, onLoadMore, hasMore });
            } catch (err) {
              console.error(`[CustomView] Error render vista ${activeCustomView.id}:`, err);
            }
          }
        }}
      />
    );
  }

  const handleOpenLink = async (url?: string | null) => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      try {
        await invoke('open_external_url', { url });
      } catch {
        window.open(url, '_blank');
      }
    }
  };

  return (
    <div>
      <div className="stats-container">
        <span>
          <strong>{total.toLocaleString('es-ES')}</strong> resultados de{' '}
          {totalItemsCount.toLocaleString('es-ES')} elementos
        </span>
        <span className="stats-rust-badge">{tookMs.toFixed(1)} ms · Rust FTS5</span>
      </div>

      <div id="results" className={`results-grid ${viewMode === 'grid' ? 'view-grid' : ''}`}>
        {items.map((item) => {
          const isMagnet = item.link?.startsWith('magnet:');
          const hasLink = Boolean(item.link && item.link.trim());
          const initial = item.title.charAt(0).toUpperCase();

          if (viewMode === 'grid') {
            return (
              <div key={item.id} className="grid-card">
                <div className="grid-cover" style={{ background: getCardGradient(item.title) }}>
                  <div className="grid-cover__initial">{initial}</div>
                  <div className="grid-cover__pill">{item.source_name}</div>
                </div>

                <div className="grid-body">
                  <h3 className="grid-title" title={item.title}>
                    {item.title}
                  </h3>
                  {item.subtitle && <p className="grid-subtitle">{item.subtitle}</p>}

                  <div className="grid-badges">
                    {item.file_size && <span className="meta-badge">{item.file_size}</span>}
                  </div>
                </div>

                <div className="grid-foot">
                  {/* Slot para acciones inyectadas por plugins */}
                  <Slot name="card_actions" context={item} />

                  {hasLink ? (
                    <button
                      type="button"
                      className="grid-open"
                      onClick={() => handleOpenLink(item.link)}
                      title={item.link || ''}
                    >
                      <span>{isMagnet ? 'Magnet' : 'Abrir'}</span>
                      <ExternalLink size={11} />
                    </button>
                  ) : (
                    <span className="grid-no-link">Sin enlace</span>
                  )}
                </div>
              </div>
            );
          }

          // Vista Lista
          return (
            <div key={item.id} className="game-card">
              <div className="game-info-container">
                <h3 title={item.title}>{item.title}</h3>
                {item.subtitle && <p className="game-subtitle">{item.subtitle}</p>}
                <div className="game-meta">
                  <span className="source-badge">{item.source_name}</span>
                  {item.file_size && (
                    <>
                      <span className="meta-sep">·</span>
                      <span className="meta-badge">{item.file_size}</span>
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {/* Slot para acciones inyectadas por plugins */}
                <Slot name="card_actions" context={item} />

                {hasLink ? (
                  <button
                    type="button"
                    className="magnet-link"
                    style={{ opacity: 1, visibility: 'visible', transform: 'none', pointerEvents: 'auto' }}
                    onClick={() => handleOpenLink(item.link)}
                    title={item.link || ''}
                  >
                    <span>{isMagnet ? 'Magnet' : 'Enlace'}</span>
                    <ExternalLink size={12} />
                  </button>
                ) : (
                  <span className="no-magnet">Sin enlace</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px' }}>
          <button type="button" className="action-btn secondary" onClick={onLoadMore} style={{ minHeight: '34px', padding: '0 20px' }}>
            Cargar más resultados
          </button>
        </div>
      )}
    </div>
  );
};
