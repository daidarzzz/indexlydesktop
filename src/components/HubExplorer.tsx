// src/components/HubExplorer.tsx — Explorador, importador y gestor de plugins directo de IndexlyHub
import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Source, LoadedPlugin } from '../types';
import { Download, Search, Star, Globe, RefreshCw, Check, Puzzle, TrendingUp, Clock, Layers, X, List as ListIcon } from 'lucide-react';
import { Button, Callout, EmptyState, Skeleton } from '../ui';

interface HubExplorerProps {
  onRefreshSources: () => Promise<void>;
  onRefreshPlugins?: () => Promise<void>;
  plugins?: LoadedPlugin[];
  sources?: Source[];
  showToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

interface HubPackage {
  id?: string;
  slug: string;
  name: string;
  description?: string;
  version?: string;
  downloads?: number;
  sources_count?: number;
  items_count?: number;
  kind?: string;
  tags?: string[];
  r2Url?: string;
  downloadUrl?: string;
  is_favorite?: boolean;
  author?: {
    name?: string;
    githubLogin?: string;
    login?: string;
  };
}

const HUB_API = 'https://indexlyhub.daida.net/api/v1';

function compareVersions(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const pa = String(a).split(/[.\-+]/).map((s) => parseInt(s, 10) || 0);
  const pb = String(b).split(/[.\-+]/).map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const HubExplorer: React.FC<HubExplorerProps> = ({
  onRefreshSources,
  onRefreshPlugins,
  plugins = [],
  sources = [],
  showToast,
}) => {
  const [tab, setTab] = useState<'popular' | 'recent' | 'plugins'>('popular');
  const [query, setQuery] = useState('');
  const [packages, setPackages] = useState<HubPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingSlug, setImportingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let endpoint = '';
      if (tab === 'plugins') {
        endpoint = `${HUB_API}/packages?kind=plugin&sort=downloads`;
      } else {
        endpoint = `${HUB_API}/packages?sort=${tab === 'popular' ? 'downloads' : 'recent'}`;
      }

      const headers: Record<string, string> = {};

      let res = await fetch(endpoint, { headers });
      // Fallback para plugins si kind=plugin no devolvió nada
      if (!res.ok && tab === 'plugins') {
        res = await fetch(`${HUB_API}/packages?tags=plugin&sort=downloads`, { headers });
      }

      if (!res.ok) {
        throw new Error(`El Hub respondió con estado ${res.status}`);
      }

      const data = await res.json();
      let list = Array.isArray(data) ? data : data.data || data.packages || [];
      if (tab === 'plugins' && list.length === 0) {
        // Segundo intento con tags=plugin
        const fallbackRes = await fetch(`${HUB_API}/packages?tags=plugin&sort=downloads`, { headers });
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          list = Array.isArray(fallbackData) ? fallbackData : fallbackData.data || fallbackData.packages || [];
        }
      }
      setPackages(list);
    } catch (err: any) {
      setError(err?.message || 'Error conectando con IndexlyHub');
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  // Importar paquete de fuentes (índice)
  const handleImport = async (pkg: HubPackage) => {
    setImportingSlug(pkg.slug);
    try {
      const created = await invoke<Source[]>('import_hub_package', {
        slug: pkg.slug,
        token: null,
      });

      const totalItems = created.reduce((acc, s) => acc + s.count, 0);
      showToast(
        `Paquete "${pkg.name || pkg.slug}" importado (${created.length} fuentes, ${totalItems.toLocaleString('es-ES')} elementos)`,
        'success'
      );
      await onRefreshSources();
    } catch (err: any) {
      showToast(`Error al importar: ${err}`, 'error');
    } finally {
      setImportingSlug(null);
    }
  };

  // Descargar / Instalar / Actualizar plugin
  const handleInstallPlugin = async (pkg: HubPackage) => {
    setImportingSlug(pkg.slug);
    try {
      const loaded = await invoke<LoadedPlugin>('install_hub_plugin', {
        slug: pkg.slug,
        token: null,
      });

      showToast(
        `Plugin "${loaded.manifest.name || pkg.name || pkg.slug}" instalado con éxito`,
        'success'
      );
      if (onRefreshPlugins) {
        await onRefreshPlugins();
      }
    } catch (err: any) {
      console.error('[HubExplorer] Error instalando plugin:', err);
      showToast(`Error al instalar plugin: ${err}`, 'error');
    } finally {
      setImportingSlug(null);
    }
  };

  const filteredPackages = packages.filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.slug && p.slug.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
  });

  const TABS: Array<{ id: typeof tab; label: string; icon: React.ReactNode }> = [
    { id: 'popular', label: 'Populares', icon: <TrendingUp size={13} /> },
    { id: 'recent', label: 'Recientes', icon: <Clock size={13} /> },
    { id: 'plugins', label: 'Plugins', icon: <Puzzle size={13} /> },
  ];

  return (
    <div className="hub">
      {/* Cabecera: presentación, estado de la conexión y buscador */}
      <header className="hub__hero">
        <div className="hub__hero-text">
          <span className="hub__eyebrow">
            <Globe size={12} aria-hidden="true" /> IndexlyHub
          </span>
          <h2>Descubre índices y plugins</h2>
          <p>Importa paquetes de la comunidad o amplía IndexLy con nuevos plugins en un clic.</p>
        </div>


        <label className="hub__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar paquetes, autores o descripciones…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar en el Hub"
          />
          {query && (
            <button type="button" className="hub__search-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
              <X size={13} />
            </button>
          )}
        </label>
      </header>

      {/* Categorías + recuento */}
      <div className="hub__bar">
        <div className="hub__tabs" role="tablist" aria-label="Secciones del Hub">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`hub__tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="hub__bar-end">
          {!loading && !error && (
            <span className="hub__count">
              {filteredPackages.length} {filteredPackages.length === 1 ? 'resultado' : 'resultados'}
            </span>
          )}
          <button
            type="button"
            className="hub__refresh"
            onClick={() => fetchPackages()}
            aria-label="Recargar catálogo"
            title="Recargar catálogo"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Cargando: tarjetas esqueleto con la misma forma que las reales */}
      {loading && (
        <div className="hub__grid" aria-busy="true" aria-label="Cargando catálogo de IndexlyHub">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="hub-card hub-card--skeleton">
              <div className="hub-card__head">
                <Skeleton shape="block" width={40} height={40} style={{ borderRadius: 10 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="60%" height={12} />
                  <Skeleton width="35%" height={10} />
                </div>
              </div>
              <Skeleton width="92%" height={10} />
              <Skeleton width="70%" height={10} />
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <Callout variant="danger" title="No se pudo cargar el Hub">
          {error}
        </Callout>
      )}

      {!loading && !error && filteredPackages.length === 0 && (
        <EmptyState
          icon={tab === 'plugins' ? <Puzzle size={22} /> : <Star size={22} />}
          title={query ? `Nada coincide con «${query}»` : `Sin ${tab === 'plugins' ? 'plugins' : 'paquetes'} en esta sección`}
          description="Prueba con otra categoría o busca por nombre."
        />
      )}

      {!loading && !error && filteredPackages.length > 0 && (
        <div className="hub__grid">
          {filteredPackages.map((pkg) => {
            const isPlugin =
              tab === 'plugins' || pkg.kind === 'plugin' || (pkg.tags && pkg.tags.includes('plugin'));

            let pluginStatus: 'not_installed' | 'installed' | 'update_available' = 'not_installed';
            let installedPlugin: LoadedPlugin | undefined;

            if (isPlugin) {
              installedPlugin = plugins.find(
                (p) =>
                  p.manifest.id === pkg.slug ||
                  p.manifest.id.toLowerCase() === (pkg.slug || '').toLowerCase() ||
                  p.manifest.name.toLowerCase() === (pkg.name || '').toLowerCase()
              );
              if (installedPlugin) {
                pluginStatus = compareVersions(installedPlugin.manifest.version, pkg.version) < 0 ? 'update_available' : 'installed';
              }
            }

            const isDataImported = !isPlugin && sources.some((s) => s.pkg?.slug === pkg.slug);
            const isWorking = importingSlug === pkg.slug;
            const name = pkg.name || pkg.slug;
            const author = pkg.author?.githubLogin || pkg.author?.login || pkg.author?.name;

            return (
              <article key={pkg.slug} className={`hub-card ${isPlugin ? 'is-plugin' : 'is-index'}`}>
                <div className="hub-card__head">
                  <div className="hub-card__avatar" style={{ background: hueGradient(name) }} aria-hidden="true">
                    {(Array.from(name.trim())[0] || '?').toUpperCase()}
                    <span className="hub-card__kind-icon">
                      {isPlugin ? <Puzzle size={10} /> : <Layers size={10} />}
                    </span>
                  </div>
                  <div className="hub-card__titles">
                    <h3 title={name}>{name}</h3>
                    <span className="hub-card__by">
                      {author ? `@${author}` : isPlugin ? 'Plugin' : 'Índice'}
                      {pkg.version && <span className="hub-card__ver">v{pkg.version}</span>}
                    </span>
                  </div>
                  <span className={`hub-card__kind ${isPlugin ? 'is-plugin' : ''}`}>{isPlugin ? 'Plugin' : 'Índice'}</span>
                </div>

                <p className="hub-card__desc">
                  {pkg.description || (isPlugin ? 'Plugin de extensión para IndexLy' : 'Paquete de índices para IndexLy')}
                </p>

                <div className="hub-card__stats">
                  {!isPlugin && pkg.sources_count ? (
                    <span title="Fuentes">
                      <Layers size={12} /> {pkg.sources_count}
                    </span>
                  ) : null}
                  {!isPlugin && pkg.items_count ? (
                    <span title="Elementos">
                      <ListIcon size={12} /> {fmtCompact(pkg.items_count)}
                    </span>
                  ) : null}
                  {pkg.downloads ? (
                    <span title="Descargas">
                      <Download size={12} /> {fmtCompact(pkg.downloads)}
                    </span>
                  ) : null}
                </div>

                <footer className="hub-card__foot">
                  <span className="hub-card__status">
                    {isPlugin && pluginStatus === 'update_available' && (
                      <span className="hub-tag is-warn">
                        v{installedPlugin?.manifest.version} → v{pkg.version}
                      </span>
                    )}
                    {isPlugin && pluginStatus === 'installed' && (
                      <span className="hub-tag is-ok">
                        <Check size={11} /> Instalado
                      </span>
                    )}
                    {!isPlugin && isDataImported && (
                      <span className="hub-tag is-ok">
                        <Check size={11} /> Importado
                      </span>
                    )}
                  </span>

                  {isPlugin ? (
                    pluginStatus === 'update_available' ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="hub-card__action is-update"
                        onClick={() => handleInstallPlugin(pkg)}
                        loading={isWorking}
                        title={`Actualizar a la versión ${pkg.version}`}
                        iconLeft={!isWorking ? <RefreshCw size={12} /> : undefined}
                      >
                        {isWorking ? 'Actualizando…' : 'Actualizar'}
                      </Button>
                    ) : pluginStatus === 'installed' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="hub-card__action"
                        onClick={() => handleInstallPlugin(pkg)}
                        loading={isWorking}
                        title="Reinstalar o refrescar versión"
                        iconLeft={!isWorking ? <RefreshCw size={12} /> : undefined}
                      >
                        {isWorking ? 'Instalando…' : 'Reinstalar'}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        className="hub-card__action"
                        onClick={() => handleInstallPlugin(pkg)}
                        loading={isWorking}
                        iconLeft={!isWorking ? <Download size={12} /> : undefined}
                      >
                        {isWorking ? 'Descargando…' : 'Instalar'}
                      </Button>
                    )
                  ) : (
                    <Button
                      variant={isDataImported ? 'secondary' : 'primary'}
                      size="sm"
                      className="hub-card__action"
                      onClick={() => handleImport(pkg)}
                      loading={isWorking}
                      iconLeft={!isWorking ? <Download size={12} /> : undefined}
                    >
                      {isWorking ? 'Descargando…' : isDataImported ? 'Reimportar' : 'Importar'}
                    </Button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Degradado estable por nombre, como los avatares de fuentes y resultados. */
function hueGradient(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 70%, 32%), hsl(${h2}, 80%, 18%))`;
}

function fmtCompact(n: number) {
  return n >= 10000
    ? new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
    : n.toLocaleString('es-ES');
}
