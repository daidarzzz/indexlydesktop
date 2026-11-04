// src/components/HubExplorer.tsx — Explorador, importador y gestor de plugins directo de IndexlyHub
import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Source, LoadedPlugin } from '../types';
import { Download, Search, Star, Globe, RefreshCw, Check, Puzzle } from 'lucide-react';
import { Button, Callout, EmptyState, Input, SegmentedControl, Spinner, type TabItem } from '../ui';

interface HubExplorerProps {
  hubToken: string | null;
  onOpenConnectModal: () => void;
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
  hubToken,
  onOpenConnectModal,
  onRefreshSources,
  onRefreshPlugins,
  plugins = [],
  sources = [],
  showToast,
}) => {
  const [tab, setTab] = useState<'popular' | 'recent' | 'plugins' | 'favorites'>('popular');
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
      if (tab === 'favorites') {
        endpoint = `${HUB_API}/favorites`;
      } else if (tab === 'plugins') {
        endpoint = `${HUB_API}/packages?kind=plugin&sort=downloads`;
      } else {
        endpoint = `${HUB_API}/packages?sort=${tab === 'popular' ? 'downloads' : 'recent'}`;
      }

      const headers: Record<string, string> = {};
      if (hubToken) {
        headers['Authorization'] = `Bearer ${hubToken}`;
      }

      let res = await fetch(endpoint, { headers });
      // Fallback para plugins si kind=plugin no devolvió nada
      if (!res.ok && tab === 'plugins') {
        res = await fetch(`${HUB_API}/packages?tags=plugin&sort=downloads`, { headers });
      }

      if (!res.ok) {
        if (res.status === 401 && tab === 'favorites') {
          throw new Error('Conecta tu token del Hub para ver tus favoritos.');
        }
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
  }, [tab, hubToken]);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  // Importar paquete de fuentes (índice)
  const handleImport = async (pkg: HubPackage) => {
    setImportingSlug(pkg.slug);
    try {
      const created = await invoke<Source[]>('import_hub_package', {
        slug: pkg.slug,
        token: hubToken,
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
        token: hubToken,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <SegmentedControl
          ariaLabel="Secciones del Hub"
          value={tab}
          onChange={(id) => setTab(id as typeof tab)}
          items={[
            { id: 'popular', label: 'Populares' },
            { id: 'recent', label: 'Recientes' },
            { id: 'plugins', label: 'Plugins' },
            { id: 'favorites', label: 'Favoritos' },
          ] satisfies TabItem[]}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '180px' }}>
            <Input
              controlSize="sm"
              leadingIcon={<Search size={13} />}
              placeholder="Buscar en el Hub…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ borderRadius: 'var(--radius-full)' }}
            />
          </div>

          {!hubToken && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenConnectModal}
              iconLeft={<Globe size={12} />}
            >
              Conectar Hub
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-secondary)', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Spinner size="md" />
          <span>Cargando catálogo de IndexlyHub…</span>
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
          title={`Sin ${tab === 'plugins' ? 'plugins' : 'paquetes'} en esta sección`}
          description="Prueba con otra categoría o busca por nombre."
        />
      )}

      {!loading && !error && filteredPackages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredPackages.map((pkg) => {
            const isPlugin =
              tab === 'plugins' ||
              pkg.kind === 'plugin' ||
              (pkg.tags && pkg.tags.includes('plugin'));

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
                const cmp = compareVersions(installedPlugin.manifest.version, pkg.version);
                if (cmp < 0) {
                  pluginStatus = 'update_available';
                } else {
                  pluginStatus = 'installed';
                }
              }
            }

            const isDataImported = !isPlugin && sources.some((s) => s.pkg?.slug === pkg.slug);
            const isWorking = importingSlug === pkg.slug;

            return (
              <div
                key={pkg.slug}
                className="index-pill"
                style={{ background: 'var(--color-surface)', cursor: 'default' }}
              >
                <div className="index-pill-info">
                  <div
                    className="index-avatar"
                    style={{
                      background: isPlugin
                        ? 'linear-gradient(135deg, rgba(168,85,247,0.25), rgba(147,51,234,0.1))'
                        : 'linear-gradient(135deg, rgba(14,165,233,0.2), rgba(56,189,248,0.05))',
                      border: isPlugin
                        ? '1px solid rgba(168,85,247,0.35)'
                        : '1px solid rgba(14,165,233,0.3)',
                      color: isPlugin ? '#c084fc' : '#38bdf8',
                    }}
                  >
                    {isPlugin ? <Puzzle size={16} /> : <Star size={16} />}
                  </div>

                  <div className="index-text">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <strong>{pkg.name || pkg.slug}</strong>

                      {/* Insignias de versión y estado */}
                      {isPlugin ? (
                        <>
                          {pluginStatus === 'update_available' && (
                            <span className="hub-upd-badge-inline">
                              v{installedPlugin?.manifest.version} → v{pkg.version} · Actualización
                            </span>
                          )}
                          {pluginStatus === 'installed' && (
                            <span className="hub-ok-badge">
                              v{installedPlugin?.manifest.version} · Instalado
                            </span>
                          )}
                          {pluginStatus === 'not_installed' && pkg.version && (
                            <span
                              style={{
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-text-tertiary)',
                              }}
                            >
                              v{pkg.version}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {isDataImported && (
                            <span className="hub-ok-badge">Importado</span>
                          )}
                          {pkg.version && (
                            <span
                              style={{
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-text-tertiary)',
                              }}
                            >
                              v{pkg.version}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    <small>
                      {pkg.author?.githubLogin ? `@${pkg.author.githubLogin} · ` : ''}
                      {isPlugin ? (
                        <>
                          {pkg.description ? pkg.description : 'Plugin de extensión para IndexLy'}
                          {pkg.downloads ? ` · ${pkg.downloads} descargas` : ''}
                        </>
                      ) : (
                        <>
                          {pkg.sources_count ? `${pkg.sources_count} fuentes · ` : ''}
                          {pkg.items_count ? `${pkg.items_count.toLocaleString('es-ES')} elementos` : ''}
                          {pkg.downloads ? ` · ${pkg.downloads} descargas` : ''}
                        </>
                      )}
                    </small>
                  </div>
                </div>

                <div className="index-pill-actions">
                  {isPlugin ? (
                    pluginStatus === 'update_available' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="upd-go"
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
                        onClick={() => handleInstallPlugin(pkg)}
                        loading={isWorking}
                        title="Reinstalar o refrescar versión"
                        iconLeft={!isWorking ? <Check size={12} style={{ color: '#4ade80' }} /> : undefined}
                      >
                        {isWorking ? 'Instalando…' : 'Al día'}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
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
                      onClick={() => handleImport(pkg)}
                      loading={isWorking}
                      iconLeft={!isWorking ? <Download size={12} /> : undefined}
                    >
                      {isWorking
                        ? 'Descargando…'
                        : isDataImported
                        ? 'Reimportar'
                        : 'Importar'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
