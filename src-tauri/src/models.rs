// src-tauri/src/models.rs — Modelos centrales de IndexLy Desktop
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedItem {
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub file_size: Option<String>,
    #[serde(default)]
    pub file_size_bytes: Option<i64>,
    pub link: Option<String>,
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub count: usize,
    pub mapping: Option<MappingConfig>,
    pub pkg: Option<PackageInfo>,
    pub flags: Option<std::collections::HashMap<String, bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceMappingInfo {
    pub source: Source,
    pub available_keys: Vec<String>,
    pub sample_raw: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingConfig {
    #[serde(alias = "title_key")]
    pub title_key: Option<String>,
    #[serde(alias = "link_key")]
    pub link_key: Option<String>,
    #[serde(alias = "subtitle_key")]
    pub subtitle_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageInfo {
    pub slug: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub items: Vec<UnifiedItem>,
    pub total: usize,
    pub active_sources_count: usize,
    pub total_items_count: usize,
    pub took_ms: f64,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub entry_ui: Option<String>,
    #[serde(default)]
    pub entry_backend: Option<String>,
    #[serde(default)]
    pub settings: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub styles: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicWindowConfig {
    pub label: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub transparent: Option<bool>,
    pub decorations: Option<bool>,
    pub always_on_top: Option<bool>,
    pub skip_taskbar: Option<bool>,
    pub center: Option<bool>,
    pub resizable: Option<bool>,
    pub shadow: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessRunResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoMappingResult {
    pub available_keys: Vec<String>,
    pub mapping: MappingConfig,
    pub preview_count: usize,
}
