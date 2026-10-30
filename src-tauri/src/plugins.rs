// src-tauri/src/plugins.rs — Gestor y descubrimiento de plugins
use crate::models::PluginManifest;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedPlugin {
    pub manifest: PluginManifest,
    pub js_bundle: Option<String>,
    pub css_bundle: Option<String>,
}

pub struct PluginManager {
    plugins_dir: PathBuf,
    loaded: Mutex<Vec<LoadedPlugin>>,
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

impl PluginManager {
    pub fn new<P: AsRef<Path>>(plugins_dir: P) -> Self {
        let p = plugins_dir.as_ref().to_path_buf();
        let _ = fs::create_dir_all(&p);
        let mgr = Self {
            plugins_dir: p,
            loaded: Mutex::new(Vec::new()),
        };
        mgr.ensure_bundled_plugins();
        mgr.reload();
        mgr
    }

    pub fn reload(&self) {
        let mut list = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.plugins_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let manifest_file = path.join("manifest.json");

                    if manifest_file.exists() {
                        if let Ok(content) = fs::read_to_string(&manifest_file) {
                            let clean_content = content.trim_start_matches('\u{feff}');
                            if let Ok(manifest) = serde_json::from_str::<PluginManifest>(clean_content) {
                                let js = manifest
                                    .main
                                    .as_ref()
                                    .and_then(|m| fs::read_to_string(path.join(m)).ok())
                                    .or_else(|| fs::read_to_string(path.join("main.js")).ok())
                                    .or_else(|| fs::read_to_string(path.join("index.js")).ok());

                                let css = manifest
                                    .styles
                                    .as_ref()
                                    .and_then(|s| fs::read_to_string(path.join(s)).ok())
                                    .or_else(|| fs::read_to_string(path.join("style.css")).ok())
                                    .or_else(|| fs::read_to_string(path.join("styles.css")).ok());

                                list.push(LoadedPlugin {
                                    manifest,
                                    js_bundle: js,
                                    css_bundle: css,
                                });
                            }
                        }
                    } else {
                        let js_file = if path.join("index.js").exists() {
                            Some(path.join("index.js"))
                        } else if path.join("main.js").exists() {
                            Some(path.join("main.js"))
                        } else {
                            None
                        };
                        let css_file = if path.join("style.css").exists() {
                            Some(path.join("style.css"))
                        } else if path.join("styles.css").exists() {
                            Some(path.join("styles.css"))
                        } else {
                            None
                        };

                        let js = js_file.and_then(|p| fs::read_to_string(p).ok());
                        let css = css_file.and_then(|p| fs::read_to_string(p).ok());

                        if let Some(ref js_code) = js {
                            if let Some(manifest) = parse_plugin_header(js_code) {
                                list.push(LoadedPlugin {
                                    manifest,
                                    js_bundle: js,
                                    css_bundle: css,
                                });
                            }
                        }
                    }
                } else if path.extension().and_then(|s| s.to_str()) == Some("js") {
                    // Soporte para archivos .js sueltos directos en la carpeta plugins
                    if let Ok(js_code) = fs::read_to_string(&path) {
                        if let Some(manifest) = parse_plugin_header(&js_code) {
                            list.push(LoadedPlugin {
                                manifest,
                                js_bundle: Some(js_code),
                                css_bundle: None,
                            });
                        }
                    }
                }
            }
        }

        let mut lock = self.loaded.lock().unwrap();
        *lock = list;
    }

    fn ensure_bundled_plugins(&self) {
        let env_path = std::env::var("INDEXLY_BUNDLED_PLUGINS_DIR").ok().map(std::path::PathBuf::from);
        let rel_plugins = Path::new("plugins");
        let rel_parent_plugins = Path::new("..").join("plugins");
        let rel_public = Path::new("..").join("public").join("plugins");

        let search_paths: Vec<PathBuf> = [
            env_path.filter(|p| p.exists()),
            if rel_plugins.exists() { Some(rel_plugins.to_path_buf()) } else { None },
            if rel_parent_plugins.exists() { Some(rel_parent_plugins) } else { None },
            if rel_public.exists() { Some(rel_public) } else { None },
        ]
        .into_iter()
        .flatten()
        .collect();

        for search_path in search_paths {
            if let Ok(entries) = fs::read_dir(&search_path) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let dir_name = entry.file_name();
                        let target_dir = self.plugins_dir.join(&dir_name);
                        if !target_dir.exists() {
                            let _ = copy_dir_all(&p, &target_dir);
                        }
                    } else if p.extension().and_then(|e| e.to_str()) == Some("js") {
                        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                            let target_plugin_dir = self.plugins_dir.join(stem);
                            let target_index_js = target_plugin_dir.join("index.js");

                            if !target_plugin_dir.exists() {
                                let _ = fs::create_dir_all(&target_plugin_dir);
                                if let Ok(code) = fs::read_to_string(&p) {
                                    let _ = fs::write(&target_index_js, &code);
                                    if let Some(mut manifest) = parse_plugin_header(&code) {
                                        manifest.enabled = stem == "vistas" || stem == "readly";
                                        if let Ok(m_json) = serde_json::to_string_pretty(&manifest) {
                                            let _ = fs::write(target_plugin_dir.join("manifest.json"), m_json);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn get_plugins(&self) -> Vec<LoadedPlugin> {
        self.loaded.lock().unwrap().clone()
    }

    pub fn is_plugin_enabled(&self, id: &str) -> bool {
        let lock = self.loaded.lock().unwrap();
        lock.iter().any(|p| p.manifest.id == id && p.manifest.enabled)
    }

    pub fn toggle_plugin(&self, id: &str, enabled: bool) -> bool {
        let mut lock = self.loaded.lock().unwrap();
        for p in lock.iter_mut() {
            if p.manifest.id == id {
                p.manifest.enabled = enabled;
                let mut target_file = self.plugins_dir.join(id).join("manifest.json");
                if !target_file.exists() {
                    if let Ok(entries) = fs::read_dir(&self.plugins_dir) {
                        for entry in entries.flatten() {
                            let dir_path = entry.path();
                            if dir_path.is_dir() {
                                let mf = dir_path.join("manifest.json");
                                if mf.exists() {
                                    if let Ok(content) = fs::read_to_string(&mf) {
                                        let clean = content.trim_start_matches('\u{feff}');
                                        if let Ok(m) = serde_json::from_str::<PluginManifest>(clean) {
                                            if m.id == id {
                                                target_file = mf;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if let Ok(content) = serde_json::to_string_pretty(&p.manifest) {
                    let _ = fs::write(target_file, content);
                }
                return true;
            }
        }
        false
    }

    pub fn install_plugin(
        &self,
        mut manifest: PluginManifest,
        js_code: &str,
        css_code: Option<&str>,
    ) -> Result<LoadedPlugin, String> {
        let dir = self.plugins_dir.join(&manifest.id);
        fs::create_dir_all(&dir).map_err(|e| format!("Error creando carpeta de plugin: {}", e))?;

        // Si ya existía, preservar el estado enabled
        let previous_enabled = {
            let lock = self.loaded.lock().unwrap();
            lock.iter()
                .find(|p| p.manifest.id == manifest.id)
                .map(|p| p.manifest.enabled)
        };
        if let Some(prev) = previous_enabled {
            manifest.enabled = prev;
        } else {
            manifest.enabled = true;
        }

        let js_path = dir.join("index.js");
        fs::write(&js_path, js_code).map_err(|e| format!("Error guardando index.js: {}", e))?;

        let css_bundle = if let Some(css) = css_code {
            if !css.trim().is_empty() {
                let css_path = dir.join("style.css");
                let _ = fs::write(&css_path, css);
                Some(css.to_string())
            } else {
                None
            }
        } else {
            None
        };

        let manifest_path = dir.join("manifest.json");
        let manifest_json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("Error serializando manifiesto: {}", e))?;
        fs::write(&manifest_path, manifest_json)
            .map_err(|e| format!("Error guardando manifest.json: {}", e))?;

        let loaded = LoadedPlugin {
            manifest,
            js_bundle: Some(js_code.to_string()),
            css_bundle,
        };

        self.reload();
        Ok(loaded)
    }
}

pub fn parse_plugin_header(code: &str) -> Option<PluginManifest> {
    let start = code.find("/* IndexLy Plugin")?;
    let end = code[start..].find("*/")? + start;
    let header_comment = &code[start..end];

    let mut id = None;
    let mut name = None;
    let mut version = "1.0.0".to_string();
    let mut description = "".to_string();
    let mut permissions = Vec::new();

    for line in header_comment.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().trim_start_matches('*').trim().to_lowercase();
            let val = v.trim();
            match key.as_str() {
                "id" => id = Some(val.to_string()),
                "name" => name = Some(val.to_string()),
                "version" => version = val.to_string(),
                "description" => description = val.to_string(),
                "permissions" => {
                    permissions = val
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                _ => {}
            }
        }
    }

    let plugin_id = id?;
    let plugin_name = name.unwrap_or_else(|| plugin_id.clone());
    let is_vistas = plugin_id == "vistas";

    Some(PluginManifest {
        id: plugin_id,
        name: plugin_name,
        version,
        description,
        permissions: permissions.clone(),
        capabilities: permissions,
        author: None,
        enabled: is_vistas,
        entry_ui: Some("index.js".to_string()),
        entry_backend: None,
        settings: None,
        main: Some("index.js".to_string()),
        styles: None,
    })
}
