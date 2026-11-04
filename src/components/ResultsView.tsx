// src/components/ResultsView.tsx — Renderizado de resultados (Lista y Cuadrícula con slots)
import React, { useEffect, useState } from 'react';
import { UnifiedItem } from '../types';
import { CardActionsMenu } from './CardActionsMenu';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { ExternalLink, Magnet, SearchX } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { IndexlyLogo } from './IndexlyLogo';
import { Button, EmptyState, Skeleton } from '../ui';

interface ResultsViewProps {
  items: UnifiedItem[];
  total: number;
  totalItemsCount: number;
  activeSourcesCount: number;
  tookMs: number;
  viewMode: 'list' | 'grid';
  onLoadMore?: () => void;
  hasMore?: boolean;
  /** Primera carga en curso: muestra un esqueleto en lugar del estado vacío. */
  isLoading?: boolean;
}

/** Tono (0-359) estable derivado del texto; da a cada elemento/fuente su color. */
function getHue(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 360);
}

function getCardGradient(title: string) {
  const h1 = getHue(title);
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
  isLoading = false,
}) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    return pluginRegistry.subscribe(() => setTick((t) => t + 1));
  }, []);

  const activeCustomView = pluginRegistry.getActiveView();

  if (isLoading && items.length === 0) {
    return (
      <div className="results-skeleton" aria-busy="true" aria-label="Cargando resultados">
        {[0, 1, 2].map((i) => (
          <div key={i} className="results-skeleton__row">
            <div className="results-skeleton__text">
              <Skeleton width={`${60 - i * 12}%`} height={12} />
              <Skeleton width="34%" height={10} />
            </div>
            <Skeleton shape="block" width={72} height={28} style={{ borderRadius: 999 }} />
          </div>
        ))}
      </div>
    );
  }

  if (activeSourcesCount === 0 && items.length === 0) {
    return (
      <EmptyState
        style={{ marginTop: '36px' }}
        icon={<IndexlyLogo size={30} style={{ borderRadius: '8px' }} />}
        title="No hay fuentes activas"
        description="Activa o añade al menos una fuente en el gestor superior para comenzar a buscar en tus índices."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        style={{ marginTop: '28px' }}
        tone="warning"
        icon={<SearchX size={26} />}
        title="Sin resultados"
        description="No se encontraron coincidencias para tu búsqueda."
        hints={[
          'Revisa la ortografía',
          'Prueba términos más generales',
          'Comprueba filtros activos',
        ]}
      />
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

      <div id="results" className={`results-grid ${viewMode === 'grid' ? 'view-grid' : 'view-list'}`}>
        {items.map((item) => {
          const isMagnet = item.link?.startsWith('magnet:');
          const hasLink = Boolean(item.link && item.link.trim());
          const initial = item.title.charAt(0).toUpperCase();

          if (viewMode === 'grid') {
            const hue = getHue(item.title);
            const srcHue = getHue(item.source_name || '');
            return (
              <div
                key={`grid-${item.id}`}
                className={`tile ${hasLink ? 'has-link' : ''}`}
                style={{ '--tile-hue': hue, '--src-hue': srcHue } as React.CSSProperties}
                tabIndex={hasLink ? 0 : -1}
                onDoubleClick={() => hasLink && handleOpenLink(item.link)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hasLink && e.target === e.currentTarget) handleOpenLink(item.link);
                }}
              >
                <div className="tile__head">
                  <div className="tile__avatar" style={{ background: getCardGradient(item.title) }} aria-hidden="true">
                    {initial}
                  </div>
                  <div className="tile__text">
                    <h3 className="tile__title" title={item.title}>
                      {item.title}
                    </h3>
                    {(item.subtitle || item.file_size) && (
                      <p className="tile__sub">
                        {item.subtitle && <span className="tile__subtitle" title={item.subtitle}>{item.subtitle}</span>}
                        {item.file_size && <span className="tile__size">{item.file_size}</span>}
                      </p>
                    )}
                  </div>
                </div>

                <div className="tile__foot">
                  <span className="tile__source" title={item.source_name}>
                    <span className="tile__dot" aria-hidden="true" />
                    <span className="tile__source-name">{item.source_name}</span>
                  </span>

                  {/* Acciones de plugins agrupadas en el menú "⋯" */}
                  <CardActionsMenu item={item} />

                  {hasLink ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="tile__open result-row__open"
                      onClick={() => handleOpenLink(item.link)}
                      title={item.link || ''}
                      aria-label={isMagnet ? `Abrir magnet de ${item.title}` : `Abrir ${item.title}`}
                      iconRight={isMagnet ? <Magnet size={12} /> : <ExternalLink size={12} />}
                    >
                      {isMagnet ? 'Magnet' : 'Abrir'}
                    </Button>
                  ) : (
                    <span className="result-row__nolink">Sin enlace</span>
                  )}
                </div>
              </div>
            );
          }

          // Vista Lista: filas dentro de una única superficie, con avatar del mismo
          // color que la cuadrícula para que ambas vistas se reconozcan entre sí.
          return (
            <div
              key={`list-${item.id}`}
              className={`result-row ${hasLink ? 'has-link' : ''}`}
              tabIndex={hasLink ? 0 : -1}
              onDoubleClick={() => hasLink && handleOpenLink(item.link)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasLink && e.target === e.currentTarget) handleOpenLink(item.link);
              }}
            >
              <div
                className="result-row__avatar"
                style={{ background: getCardGradient(item.title) }}
                aria-hidden="true"
              >
                {initial}
              </div>

              <div className="result-row__main">
                <h3 className="result-row__title" title={item.title}>
                  {item.title}
                </h3>
                <div className="result-row__meta">
                  {item.subtitle && (
                    <span className="result-row__subtitle" title={item.subtitle}>
                      {item.subtitle}
                    </span>
                  )}
                  <span className="result-row__source" title={item.source_name}>
                    <span className="result-row__dot" style={{ background: `hsl(${getHue(item.source_name || '')}, 70%, 58%)` }} />
                    {item.source_name}
                  </span>
                  {item.file_size && <span className="result-row__size">{item.file_size}</span>}
                </div>
              </div>

              <div className="result-actions">
                {/* Acciones de plugins agrupadas en el menú "⋯" */}
                <CardActionsMenu item={item} />

                {hasLink ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="result-row__open"
                    onClick={() => handleOpenLink(item.link)}
                    title={item.link || ''}
                    iconRight={isMagnet ? <Magnet size={12} /> : <ExternalLink size={12} />}
                  >
                    {isMagnet ? 'Magnet' : 'Abrir'}
                  </Button>
                ) : (
                  <span className="result-row__nolink">Sin enlace</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="load-more">
          <Button variant="secondary" onClick={onLoadMore}>
            Cargar más resultados
          </Button>
        </div>
      )}
    </div>
  );
};
