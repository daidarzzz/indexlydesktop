// src/types.ts — Tipos TypeScript para IndexLy Desktop

export interface UnifiedItem {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  subtitle?: string | null;
  file_size?: string | null;
  link?: string | null;
  raw?: string | null;
}

export interface MappingConfig {
  title_key?: string | null;
  link_key?: string | null;
  subtitle_key?: string | null;
}

export interface PackageInfo {
  slug: string;
  name?: string | null;
}

export interface Source {
  id: string;
  name: string;
  active: boolean;
  count: usize;
  mapping?: MappingConfig | null;
  pkg?: PackageInfo | null;
  flags?: Record<string, boolean> | null;
}

export interface SourceMappingInfo {
  source: Source;
  available_keys: string[];
  sample_raw?: Record<string, any> | null;
}

export interface IndexFlagConfig {
  pluginId: string;
  id: string;
  label: string;
  hint?: string;
  defaultValue?: boolean;
}

export interface SourceActionConfig {
  pluginId: string;
  id: string;
  label: string;
  short?: string | null;
  match?: ((source: Source) => boolean) | null;
  onClick: (source: Source) => void;
}

export type usize = number;

export interface SearchResult {
  items: UnifiedItem[];
  total: number;
  active_sources_count: number;
  total_items_count: number;
  took_ms: number;
}

export interface PluginSettingOption {
  value: string;
  label: string;
}

export interface PluginSettingSchema {
  id: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'color';
  hint?: string;
  default?: any;
  options?: PluginSettingOption[];
  min?: number;
  max?: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions?: string[];
  capabilities?: string[];
  author?: string | null;
  enabled: boolean;
  entry_ui?: string | null;
  entry_backend?: string | null;
  settings?: PluginSettingSchema[] | null;
  /** Versión del esquema de manifiesto v1. Ausente en extensiones legacy. */
  schemaVersion?: number;
  /** Versión mínima del host declarada por el plugin. */
  minHostVersion?: string;
  /** Permisos nuevos pendientes de consentimiento explícito tras una actualización. */
  pendingPermissions?: string[];
}

export interface DynamicWindowConfig {
  label: string;
  title?: string;
  url?: string;
  width?: number;
  height?: number;
  transparent?: boolean;
  decorations?: boolean;
  always_on_top?: boolean;
  skip_taskbar?: boolean;
  center?: boolean;
  resizable?: boolean;
  shadow?: boolean;
}

export interface ProcessRunResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number | null;
}

export interface CustomViewDefinition {
  id: string;
  label: string;
  icon?: string;
  render: (
    container: HTMLElement,
    props: {
      items: UnifiedItem[];
      total: number;
      viewMode: 'list' | 'grid';
      onLoadMore?: () => void;
      hasMore?: boolean;
    }
  ) => void;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  js_bundle?: string | null;
  css_bundle?: string | null;
}

export interface ToastItem {
  id: string;
  text: string;
  type?: 'success' | 'warning' | 'error' | 'info';
  action?: {
    label: string;
    onClick: () => void;
  };
}
