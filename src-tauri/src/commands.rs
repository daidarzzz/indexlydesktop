// src-tauri/src/commands.rs — Comandos IPC expuestos a la interfaz React
use crate::db::Database;
use crate::models::{
    AutoMappingResult, DynamicWindowConfig, FsEntry, MappingConfig, ProcessRunResult, SearchResult,
    Source, SourceMappingInfo, UnifiedItem,
};
use crate::normalizer::{
    detect_array, get_auto_mapping, get_available_keys, normalize_json_to_items,
    parse_csv_to_items, parse_tabular_items, parse_v2_envelope,
};
use crate::plugins::{LoadedPlugin, PluginManager};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use uuid::Uuid;

pub struct AppState {
    pub db: Arc<Database>,
    pub plugins: Arc<PluginManager>,
    pub adblock: Arc<crate::adblock::AdblockManager>,
}

/// FIX BUG 8: Extraer el info_hash SHA-1 real a partir del diccionario bencoded 'info'
pub fn extract_torrent_info_hash(bytes: &[u8]) -> Option<String> {
    use sha1::{Digest, Sha1};

    let pattern = b"4:info";
    let pos = bytes.windows(pattern.len()).position(|w| w == pattern)?;
    let start = pos + pattern.len();
    if start >= bytes.len() {
        return None;
    }

    let end = find_bencode_value_end(bytes, start)?;
    let info_bytes = &bytes[start..end];

    let mut hasher = Sha1::new();
    hasher.update(info_bytes);
    let result = hasher.finalize();
    Some(format!("{:x}", result))
}

fn find_bencode_value_end(bytes: &[u8], mut idx: usize) -> Option<usize> {
    if idx >= bytes.len() {
        return None;
    }
    match bytes[idx] {
        b'i' => {
            idx += 1;
            while idx < bytes.len() && bytes[idx] != b'e' {
                idx += 1;
            }
            if idx < bytes.len() {
                Some(idx + 1)
            } else {
                None
            }
        }
        b'l' | b'd' => {
            idx += 1;
            while idx < bytes.len() && bytes[idx] != b'e' {
                idx = find_bencode_value_end(bytes, idx)?;
            }
            if idx < bytes.len() {
                Some(idx + 1)
            } else {
                None
            }
        }
        b'0'..=b'9' => {
            let mut colon = idx;
            while colon < bytes.len() && bytes[colon].is_ascii_digit() {
                colon += 1;
            }
            if colon < bytes.len() && bytes[colon] == b':' {
                let len_str = std::str::from_utf8(&bytes[idx..colon]).ok()?;
                let len: usize = len_str.parse().ok()?;
                let end = colon + 1 + len;
                if end <= bytes.len() {
                    Some(end)
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

#[tauri::command]
pub fn import_file(
    state: State<'_, AppState>,
    name: String,
    content: String,
    mapping: Option<MappingConfig>,
) -> Result<Vec<Source>, String> {
    let clean_name = if name.trim().is_empty() {
        "Fuente sin nombre".to_string()
    } else {
        name.trim().to_string()
    };

    let stem = clean_name
        .trim_end_matches(".json")
        .trim_end_matches(".json.gz")
        .trim_end_matches(".csv")
        .trim_end_matches(".tsv")
        .trim_end_matches(".txt")
        .trim();

    // 1. Si es un archivo .torrent, NUNCA partirlo en líneas de texto binario
    if clean_name.to_lowercase().ends_with(".torrent")
        || content.starts_with("d8:announce")
        || content.starts_with("d13:announce")
        || content.starts_with("d4:info")
    {
        let game_title = clean_name
            .trim_end_matches(".torrent")
            .replace(['-', '_'], " ")
            .trim()
            .to_string();

        let source_id = Uuid::new_v4().to_string();
        let display_name = format!("🧲 {}", game_title);

        // FIX BUG 8: Extraer SHA-1 info_hash real del diccionario bencode
        let info_hash = extract_torrent_info_hash(content.as_bytes()).unwrap_or_else(|| {
            use sha1::{Digest, Sha1};
            let mut hasher = Sha1::new();
            hasher.update(content.as_bytes());
            format!("{:x}", hasher.finalize())
        });
        let magnet_link = format!("magnet:?xt=urn:btih:{}&dn={}", info_hash, game_title.replace(' ', "+"));

        let item = UnifiedItem {
            id: format!("{}:0", source_id),
            source_id: source_id.clone(),
            source_name: display_name.clone(),
            title: game_title.clone(),
            subtitle: Some("Torrent".to_string()),
            file_size: None,
            file_size_bytes: None,
            link: Some(magnet_link),
            raw: None,
        };

        let mut flags = std::collections::HashMap::new();
        flags.insert("isTorrentSource".to_string(), true);

        let source = Source {
            id: source_id,
            name: display_name,
            active: true,
            count: 1,
            mapping: None,
            pkg: None,
            flags: Some(flags),
        };

        state
            .db
            .insert_source_with_items(&source, None, &[item])
            .map_err(|e| format!("Error guardando torrent: {}", e))?;

        return Ok(vec![source]);
    }

    // 2. Intentar parsear como JSON
    if let Ok(json_val) = serde_json::from_str::<Value>(&content) {
        // ¿Es un envelope v2 de IndexLy / paquete del Hub?
        if let Some(envelope_sources) = parse_v2_envelope(&json_val, stem, stem) {
            let mut batch = Vec::new();
            let mut created_sources = Vec::new();

            for s in envelope_sources {
                created_sources.push(s.source.clone());
                batch.push((s.source, s.raw_content, s.items));
            }

            state
                .db
                .insert_sources_batch(&batch)
                .map_err(|e| format!("Error guardando paquete de fuentes: {}", e))?;

            return Ok(created_sources);
        }

        // JSON normal de una sola fuente
        let source_id = Uuid::new_v4().to_string();
        let items = normalize_json_to_items(&json_val, &source_id, &clean_name, mapping.as_ref());
        let item_count = items.len();
        let source = Source {
            id: source_id,
            name: clean_name,
            active: true,
            count: item_count,
            mapping,
            pkg: None,
            flags: None,
        };

        state
            .db
            .insert_source_with_items(&source, Some(&content), &items)
            .map_err(|e| format!("Error guardando fuente: {}", e))?;

        return Ok(vec![source]);
    }

    // 2. CSV / TSV / Texto plano
    let source_id = Uuid::new_v4().to_string();
    let items = if content.contains('\t') && content.lines().count() > 1 {
        parse_csv_to_items(&content, b'\t', &source_id, &clean_name, mapping.as_ref())
    } else if content.contains(',') && content.lines().count() > 1 {
        parse_csv_to_items(&content, b',', &source_id, &clean_name, mapping.as_ref())
    } else {
        content
            .lines()
            .enumerate()
            .filter_map(|(idx, line)| {
                let t = line.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(UnifiedItem {
                        id: format!("{}:{}", source_id, idx),
                        source_id: source_id.clone(),
                        source_name: clean_name.clone(),
                        title: t.to_string(),
                        subtitle: None,
                        file_size: None,
                        file_size_bytes: None,
                        link: None,
                        raw: None,
                    })
                }
            })
            .collect()
    };

    let item_count = items.len();
    let source = Source {
        id: source_id,
        name: clean_name,
        active: true,
        count: item_count,
        mapping,
        pkg: None,
        flags: None,
    };

    state
        .db
        .insert_source_with_items(&source, Some(&content), &items)
        .map_err(|e| format!("Error guardando fuente: {}", e))?;

    Ok(vec![source])
}

#[tauri::command]
pub fn detect_mapping(content: String) -> Result<AutoMappingResult, String> {
    let json_val = serde_json::from_str::<Value>(&content)
        .map_err(|e| format!("JSON inválido para auto-mapping: {}", e))?;
    Ok(get_auto_mapping(&json_val))
}

#[tauri::command]
pub fn get_sources(state: State<'_, AppState>) -> Result<Vec<Source>, String> {
    state
        .db
        .get_sources()
        .map_err(|e| format!("Error obteniendo fuentes: {}", e))
}

#[tauri::command]
pub fn toggle_source(state: State<'_, AppState>, id: String, active: bool) -> Result<(), String> {
    state
        .db
        .toggle_source(&id, active)
        .map_err(|e| format!("Error activando/desactivando fuente: {}", e))
}

#[tauri::command]
pub fn delete_source(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .db
        .delete_source(&id)
        .map_err(|e| format!("Error eliminando fuente: {}", e))
}

#[tauri::command]
pub fn toggle_package(state: State<'_, AppState>, slug: String, active: bool) -> Result<(), String> {
    state
        .db
        .toggle_package(&slug, active)
        .map_err(|e| format!("Error alternando estado del paquete: {}", e))
}

#[tauri::command]
pub fn delete_package(state: State<'_, AppState>, slug: String) -> Result<(), String> {
    state
        .db
        .delete_package(&slug)
        .map_err(|e| format!("Error eliminando paquete: {}", e))
}

#[tauri::command]
pub fn import_hub_package(
    state: State<'_, AppState>,
    slug: String,
    token: Option<String>,
) -> Result<Vec<Source>, String> {
    let raw_endpoint = format!("https://indexlyhub.daida.net/api/v1/packages/{}/raw", slug);
    let mut req = ureq::get(&raw_endpoint);
    if let Some(ref t) = token {
        if !t.trim().is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", t.trim()));
        }
    }

    let resp = req
        .call()
        .map_err(|e| format!("Error conectando con IndexlyHub: {}", e))?;

    let json_resp: Value = resp
        .into_json()
        .map_err(|e| format!("Respuesta inválida del Hub: {}", e))?;

    let data_obj = json_resp
        .get("data")
        .and_then(|d| d.as_object())
        .ok_or_else(|| "El Hub no devolvió datos para este paquete".to_string())?;

    let content_json: Value = if let Some(raw) = data_obj.get("rawData") {
        raw.clone()
    } else if let Some(r2_url) = data_obj.get("r2_url").and_then(|u| u.as_str()) {
        let r2_resp = ureq::get(r2_url)
            .call()
            .map_err(|e| format!("Error descargando archivo desde R2: {}", e))?;

        let mut reader = r2_resp.into_reader();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut reader, &mut bytes)
            .map_err(|e| format!("Error leyendo bytes de descarga: {}", e))?;

        let text = if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
            use flate2::read::GzDecoder;
            use std::io::Read;
            let mut gz = GzDecoder::new(&bytes[..]);
            let mut decompressed = String::new();
            gz.read_to_string(&mut decompressed)
                .map_err(|e| format!("Error descomprimiendo gzip: {}", e))?;
            decompressed
        } else {
            String::from_utf8(bytes).map_err(|e| format!("UTF-8 inválido: {}", e))?
        };

        serde_json::from_str(&text).map_err(|e| format!("JSON corrupto en descarga: {}", e))?
    } else {
        return Err("Paquete sin contenido ni URL de descarga".to_string());
    };

    // Registrar descarga en el Hub en background si es posible
    let _ = ureq::post(&format!("https://indexlyhub.daida.net/api/v1/packages/{}/download", slug)).call();

    // Parsear el paquete e insertarlo en SQLite
    if let Some(envelope_sources) = parse_v2_envelope(&content_json, &slug, &slug) {
        let mut batch = Vec::new();
        let mut created_sources = Vec::new();

        for s in envelope_sources {
            created_sources.push(s.source.clone());
            batch.push((s.source, s.raw_content, s.items));
        }

        state
            .db
            .insert_sources_batch(&batch)
            .map_err(|e| format!("Error guardando paquete en base de datos: {}", e))?;

        Ok(created_sources)
    } else {
        let source_id = Uuid::new_v4().to_string();
        let items = normalize_json_to_items(&content_json, &source_id, &slug, None);
        let item_count = items.len();
        let source = Source {
            id: source_id,
            name: slug.clone(),
            active: true,
            count: item_count,
            mapping: None,
            pkg: Some(crate::models::PackageInfo {
                slug: slug.clone(),
                name: Some(slug),
            }),
            flags: None,
        };

        state
            .db
            .insert_source_with_items(&source, Some(&content_json.to_string()), &items)
            .map_err(|e| format!("Error guardando fuente: {}", e))?;

        Ok(vec![source])
    }
}

#[tauri::command]
pub fn search_items(
    state: State<'_, AppState>,
    query: String,
    filter_link: Option<String>,
    sort_by: String,
    limit: u32,
    offset: u32,
) -> Result<SearchResult, String> {
    state
        .db
        .search(
            &query,
            filter_link.as_deref(),
            &sort_by,
            limit.clamp(1, 500),
            offset,
        )
        .map_err(|e| format!("Error en búsqueda FTS5: {}", e))
}

#[tauri::command]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_plugins(state: State<'_, AppState>) -> Result<Vec<LoadedPlugin>, String> {
    state.plugins.reload();
    Ok(state.plugins.get_plugins())
}

#[tauri::command]
pub fn toggle_plugin(app: tauri::AppHandle, state: State<'_, AppState>, id: String, enabled: bool) -> Result<(), String> {
    if state.plugins.toggle_plugin(&id, enabled) {
        // Si se deshabilita spotlight, ocultar de inmediato su ventana si estuviera visible
        if id == "spotlight" && !enabled {
            if let Some(spotlight) = app.get_webview_window("spotlight") {
                let _ = spotlight.hide();
            }
        }
        Ok(())
    } else {
        Err(format!("Plugin {} no encontrado", id))
    }
}

#[tauri::command]
pub fn get_source_mapping_info(
    state: State<'_, AppState>,
    id: String,
) -> Result<SourceMappingInfo, String> {
    let (source, raw_opt) = state
        .db
        .get_source_with_raw(&id)
        .map_err(|e| format!("Error obteniendo fuente: {}", e))?
        .ok_or_else(|| "Fuente no encontrada".to_string())?;

    let mut available_keys = Vec::new();
    let mut sample_raw = None;

    if let Some(ref raw_content) = raw_opt {
        if !raw_content.trim().is_empty() {
            if let Ok(json_val) = serde_json::from_str::<Value>(raw_content) {
                // 1. ¿Es envelope o tabular directo?
                let d_val = json_val.get("d").unwrap_or(&json_val);
                if let Some(d_obj) = d_val.as_object() {
                    if let (Some(Value::Array(k_arr)), Some(Value::Array(v_arr))) = (d_obj.get("k"), d_obj.get("v")) {
                        let keys: Vec<String> = k_arr.iter().filter_map(|k| k.as_str().map(|s| s.to_string())).collect();
                        let sample = if let Some(Value::Array(first_row)) = v_arr.first() {
                            let mut obj = serde_json::Map::new();
                            for (i, key) in keys.iter().enumerate() {
                                if let Some(val) = first_row.get(i) {
                                    obj.insert(key.clone(), val.clone());
                                }
                            }
                            Some(Value::Object(obj))
                        } else {
                            None
                        };
                        return Ok(SourceMappingInfo {
                            source,
                            available_keys: keys,
                            sample_raw: sample,
                        });
                    }
                }

                // 2. ¿Es array u objeto normal?
                if let Some((arr, _)) = detect_array(d_val) {
                    let keys = get_available_keys(d_val);
                    let sample = arr.first().cloned();
                    if !keys.is_empty() {
                        return Ok(SourceMappingInfo {
                            source,
                            available_keys: keys,
                            sample_raw: sample,
                        });
                    }
                }

                let keys = get_available_keys(d_val);
                if !keys.is_empty() {
                    return Ok(SourceMappingInfo {
                        source,
                        available_keys: keys,
                        sample_raw: Some(d_val.clone()),
                    });
                }
            } else {
                // Posible CSV / TSV
                let first_line = raw_content.lines().next().unwrap_or("");
                if first_line.contains('\t') || first_line.contains(',') {
                    let delim = if first_line.contains('\t') { '\t' } else { ',' };
                    let cols: Vec<String> = first_line
                        .split(delim)
                        .map(|s| s.trim().trim_matches('"').to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if cols.len() > 1 {
                        available_keys = cols;
                    }
                }
            }
        }
    }

    // Fallback de alta fidelidad si no se obtuvieron keys (e.g. raw_content era NULL):
    // Consultar el sample item directamente de la base de datos SQLite
    if available_keys.is_empty() {
        if let Ok(Some(sample_item)) = state.db.get_sample_item(&id) {
            if let Some(ref raw_str) = sample_item.raw {
                if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(raw_str) {
                    available_keys = map.keys().cloned().collect();
                    sample_raw = Some(Value::Object(map));
                }
            }
            if available_keys.is_empty() {
                available_keys = vec![
                    "titulo".to_string(),
                    "enlace".to_string(),
                    "subtitulo".to_string(),
                    "tamaño".to_string(),
                ];
                let mut map = serde_json::Map::new();
                map.insert("titulo".to_string(), Value::String(sample_item.title.clone()));
                if let Some(l) = sample_item.link {
                    map.insert("enlace".to_string(), Value::String(l));
                }
                if let Some(s) = sample_item.subtitle {
                    map.insert("subtitulo".to_string(), Value::String(s));
                }
                if let Some(sz) = sample_item.file_size {
                    map.insert("tamaño".to_string(), Value::String(sz));
                }
                sample_raw = Some(Value::Object(map));
            }
        }
    }

    Ok(SourceMappingInfo {
        source,
        available_keys,
        sample_raw,
    })
}

#[tauri::command]
pub fn update_source_mapping(
    state: State<'_, AppState>,
    id: String,
    name: String,
    mapping: MappingConfig,
    flags: Option<std::collections::HashMap<String, bool>>,
) -> Result<Source, String> {
    let clean_name = name.trim().to_string();
    if clean_name.is_empty() {
        return Err("El nombre de la fuente no puede estar vacío".to_string());
    }

    let (source, raw_opt) = state
        .db
        .get_source_with_raw(&id)
        .map_err(|e| format!("Error obteniendo fuente: {}", e))?
        .ok_or_else(|| "Fuente no encontrada".to_string())?;

    let raw_content = raw_opt.unwrap_or_default();
    let mut new_items = Vec::new();

    if !raw_content.trim().is_empty() {
        if let Ok(json_val) = serde_json::from_str::<Value>(&raw_content) {
            let d_val = json_val.get("d").unwrap_or(&json_val);
            if let Some(d_obj) = d_val.as_object() {
                if let (Some(Value::Array(k_arr)), Some(Value::Array(v_arr))) = (d_obj.get("k"), d_obj.get("v")) {
                    let columns: Vec<String> = k_arr.iter().filter_map(|k| k.as_str().map(|s| s.to_string())).collect();
                    new_items = parse_tabular_items(&columns, v_arr, &id, &clean_name, Some(&mapping));
                } else {
                    new_items = normalize_json_to_items(d_val, &id, &clean_name, Some(&mapping));
                }
            } else {
                new_items = normalize_json_to_items(d_val, &id, &clean_name, Some(&mapping));
            }
        } else if raw_content.contains('\t') && raw_content.lines().count() > 1 {
            new_items = parse_csv_to_items(&raw_content, b'\t', &id, &clean_name, Some(&mapping));
        } else if raw_content.contains(',') && raw_content.lines().count() > 1 {
            new_items = parse_csv_to_items(&raw_content, b',', &id, &clean_name, Some(&mapping));
        }
    }

    // Si new_items está vacío pero en SQLite ya existían items (caso stream-1 donde raw_content era NULL):
    // Remapear directamente desde los items guardados en SQLite
    if new_items.is_empty() {
        if let Ok(existing) = state.db.get_items_by_source(&id) {
            if !existing.is_empty() {
                let mut reconstructed_raw_list = Vec::new();
                for mut item in existing {
                    item.source_name = clean_name.clone();
                    if let Some(ref raw_str) = item.raw {
                        if let Ok(raw_obj) = serde_json::from_str::<Value>(raw_str) {
                            if let Value::Object(ref map) = raw_obj {
                                reconstructed_raw_list.push(raw_obj.clone());
                                if let Some(ref tk) = mapping.title_key {
                                    if let Some(val) = map.get(tk).and_then(|v| v.as_str()) {
                                        item.title = val.trim().to_string();
                                    }
                                }
                                if let Some(ref lk) = mapping.link_key {
                                    if let Some(val) = map.get(lk) {
                                        item.link = match val {
                                            Value::String(s) => Some(s.clone()),
                                            Value::Array(a) => a.first().and_then(|u| u.as_str()).map(|s| s.to_string()),
                                            _ => None,
                                        };
                                    }
                                }
                                if let Some(ref sk) = mapping.subtitle_key {
                                    if let Some(val) = map.get(sk).and_then(|v| v.as_str()) {
                                        item.subtitle = Some(val.trim().to_string());
                                    }
                                }
                            }
                        }
                    }
                    new_items.push(item);
                }

                if !reconstructed_raw_list.is_empty() {
                    let _ = state.db.update_source_raw_content(
                        &id,
                        &serde_json::to_string(&reconstructed_raw_list).unwrap_or_default(),
                    );
                }
            }
        }
    }

    let item_count = new_items.len();
    state
        .db
        .update_source_mapping_and_items(&id, &clean_name, Some(&mapping), flags.as_ref(), &new_items)
        .map_err(|e| format!("Error actualizando fuente en base de datos: {}", e))?;

    Ok(Source {
        id,
        name: clean_name,
        active: source.active,
        count: item_count,
        mapping: Some(mapping),
        pkg: source.pkg,
        flags,
    })
}

#[tauri::command]
pub fn get_source_items(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<UnifiedItem>, String> {
    state
        .db
        .get_items_by_source(&id)
        .map_err(|e| format!("Error obteniendo items de fuente: {}", e))
}

#[tauri::command]
pub fn install_hub_plugin(
    state: State<'_, AppState>,
    slug: String,
    token: Option<String>,
) -> Result<LoadedPlugin, String> {
    let raw_endpoint = format!("https://indexlyhub.daida.net/api/v1/packages/{}/raw", slug);
    let mut req = ureq::get(&raw_endpoint);
    if let Some(ref t) = token {
        if !t.trim().is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", t.trim()));
        }
    }

    let resp = req
        .call()
        .map_err(|e| format!("Error conectando con IndexlyHub: {}", e))?;

    let json_resp: Value = resp
        .into_json()
        .map_err(|e| format!("Respuesta inválida del Hub: {}", e))?;

    let data_obj = json_resp
        .get("data")
        .and_then(|d| d.as_object())
        .ok_or_else(|| "El Hub no devolvió datos para este paquete".to_string())?;

    let content_json: Value = if let Some(raw) = data_obj.get("rawData") {
        raw.clone()
    } else if let Some(r2_url) = data_obj.get("r2_url").and_then(|u| u.as_str()) {
        let r2_resp = ureq::get(r2_url)
            .call()
            .map_err(|e| format!("Error descargando archivo desde R2: {}", e))?;

        let mut reader = r2_resp.into_reader();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut reader, &mut bytes)
            .map_err(|e| format!("Error leyendo bytes de descarga: {}", e))?;

        let text = if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
            use flate2::read::GzDecoder;
            use std::io::Read;
            let mut gz = GzDecoder::new(&bytes[..]);
            let mut decompressed = String::new();
            gz.read_to_string(&mut decompressed)
                .map_err(|e| format!("Error descomprimiendo gzip: {}", e))?;
            decompressed
        } else {
            String::from_utf8(bytes).map_err(|e| format!("UTF-8 inválido: {}", e))?
        };

        serde_json::from_str(&text).map_err(|e| format!("JSON corrupto en descarga: {}", e))?
    } else {
        return Err("Paquete sin contenido ni URL de descarga".to_string());
    };

    // Extraer manifiesto y código del plugin
    let pl_obj = content_json
        .get("plugin")
        .and_then(|p| p.as_object())
        .or_else(|| content_json.as_object())
        .ok_or_else(|| "El paquete no tiene formato de plugin".to_string())?;

    let plugin_id = pl_obj
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| slug.clone());

    let plugin_name = pl_obj
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| plugin_id.clone());

    let plugin_version = pl_obj
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("1.0.0")
        .to_string();

    let plugin_desc = pl_obj
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let permissions: Vec<String> = pl_obj
        .get("permissions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let schema_version = pl_obj
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let min_host_version = pl_obj
        .get("minHostVersion")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let code = pl_obj
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "El paquete del plugin no contiene código JavaScript".to_string())?;

    let css = pl_obj.get("css").and_then(|v| v.as_str());

    let manifest = crate::models::PluginManifest {
        id: plugin_id,
        name: plugin_name,
        version: plugin_version,
        description: plugin_desc,
        permissions: permissions.clone(),
        capabilities: permissions,
        author: None,
        // `install_plugin` decide el estado final: desactivado en instalaciones
        // nuevas y preservado (o forzado a desactivado) en actualizaciones.
        enabled: false,
        entry_ui: Some("index.js".to_string()),
        entry_backend: None,
        settings: None,
        main: Some("index.js".to_string()),
        styles: None,
        schema_version,
        min_host_version,
        pending_permissions: Vec::new(),
    };

    let loaded = state
        .plugins
        .install_plugin(manifest, code, css)
        .map_err(|e| format!("Error instalando plugin: {}", e))?;

    // Registrar descarga en el Hub en segundo plano
    let _ = ureq::post(&format!("https://indexlyhub.daida.net/api/v1/packages/{}/download", slug)).call();

    Ok(loaded)
}

#[tauri::command]
pub fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

// -------------------------------------------------------------
// COMANDOS DEL CO-KERNEL (Superpoderes para plugins)
// -------------------------------------------------------------

#[tauri::command]
pub async fn native_create_window(
    app: AppHandle,
    config: DynamicWindowConfig,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(&config.label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let url_str = config.url.unwrap_or_else(|| "index.html".to_string());
    let webview_url = tauri::WebviewUrl::App(url_str.into());

    let mut builder = tauri::WebviewWindowBuilder::new(&app, &config.label, webview_url)
        .title(config.title.as_deref().unwrap_or("IndexLy Window"));

    if let (Some(w), Some(h)) = (config.width, config.height) {
        builder = builder.inner_size(w, h);
    }
    if let Some(transparent) = config.transparent {
        builder = builder.transparent(transparent);
    }
    if let Some(decorations) = config.decorations {
        builder = builder.decorations(decorations);
    }
    if let Some(always_on_top) = config.always_on_top {
        builder = builder.always_on_top(always_on_top);
    }
    if let Some(skip_taskbar) = config.skip_taskbar {
        builder = builder.skip_taskbar(skip_taskbar);
    }
    if let Some(resizable) = config.resizable {
        builder = builder.resizable(resizable);
    }
    if let Some(shadow) = config.shadow {
        builder = builder.shadow(shadow);
    }
    if config.center.unwrap_or(true) {
        builder = builder.center();
    }

    builder
        .build()
        .map_err(|e| format!("Error creando ventana: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn native_show_window(app: AppHandle, label: String) -> Result<(), String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Ventana '{}' no encontrada", label))?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.unminimize();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
pub fn native_hide_window(app: AppHandle, label: String) -> Result<(), String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Ventana '{}' no encontrada", label))?;
    win.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn native_close_window(app: AppHandle, label: String) -> Result<(), String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Ventana '{}' no encontrada", label))?;
    win.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn native_toggle_window(app: AppHandle, label: String) -> Result<bool, String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Ventana '{}' no encontrada", label))?;
    let is_visible = win.is_visible().map_err(|e| e.to_string())?;
    if is_visible {
        win.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        win.show().map_err(|e| e.to_string())?;
        let _ = win.unminimize();
        let _ = win.set_focus();
        Ok(true)
    }
}

#[tauri::command]
pub async fn native_spawn_process(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<ProcessRunResult, String> {
    use std::process::Command;
    let mut cmd = Command::new(&command);
    cmd.args(&args);
    if let Some(c) = cwd {
        cmd.current_dir(c);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Error ejecutando '{}': {}", command, e))?;
    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(ProcessRunResult {
        exit_code,
        stdout,
        stderr,
    })
}

#[tauri::command]
pub fn native_fs_read_dir(path: String, recursive: Option<bool>) -> Result<Vec<FsEntry>, String> {
    use std::fs;
    use std::path::Path;

    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("La ruta '{}' no existe", path));
    }

    let mut entries = Vec::new();
    let is_rec = recursive.unwrap_or(false);

    fn collect_dir(dir: &Path, is_rec: bool, entries: &mut Vec<FsEntry>) -> std::io::Result<()> {
        if let Ok(read_dir) = fs::read_dir(dir) {
            for entry in read_dir.flatten() {
                let ep = entry.path();
                let is_dir = ep.is_dir();
                let size = if is_dir {
                    None
                } else {
                    entry.metadata().ok().map(|m| m.len())
                };
                let name = entry.file_name().to_string_lossy().to_string();
                entries.push(FsEntry {
                    name,
                    path: ep.to_string_lossy().to_string(),
                    is_dir,
                    size,
                });
                if is_dir && is_rec {
                    let _ = collect_dir(&ep, is_rec, entries);
                }
            }
        }
        Ok(())
    }

    collect_dir(p, is_rec, &mut entries).map_err(|e| e.to_string())?;
    Ok(entries)
}

#[tauri::command]
pub fn native_fs_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Error leyendo '{}': {}", path, e))
}

#[tauri::command]
pub fn native_fs_write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, content).map_err(|e| format!("Error escribiendo '{}': {}", path, e))
}

#[tauri::command]
pub fn native_fs_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
pub fn native_sql_execute(state: State<'_, AppState>, query: String) -> Result<usize, String> {
    state
        .db
        .execute_raw(&query)
        .map_err(|e| format!("Error ejecutando SQL: {}", e))
}

#[tauri::command]
pub fn native_sql_query(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<serde_json::Value>, String> {
    state
        .db
        .query_raw_json(&query)
        .map_err(|e| format!("Error consultando SQL: {}", e))
}

#[tauri::command]
pub fn native_register_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    let sc = shortcut
        .parse::<Shortcut>()
        .map_err(|_| format!("Atajo inválido: '{}'", shortcut))?;
    app.global_shortcut()
        .register(sc)
        .map_err(|e| format!("Error registrando atajo: {}", e))
}

#[tauri::command]
pub fn native_unregister_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    let sc = shortcut
        .parse::<Shortcut>()
        .map_err(|_| format!("Atajo inválido: '{}'", shortcut))?;
    app.global_shortcut()
        .unregister(sc)
        .map_err(|e| format!("Error desregistrando atajo: {}", e))
}

#[tauri::command]
pub fn adblock_check_url(
    state: State<'_, AppState>,
    url: String,
    source_url: Option<String>,
) -> bool {
    let src = source_url.as_deref().unwrap_or(&url);
    state.adblock.is_url_blocked(&url, src, "subdocument")
}

#[tauri::command]
pub fn adblock_get_info(
    state: State<'_, AppState>,
) -> crate::adblock::AdblockInfo {
    state.adblock.get_info()
}

#[tauri::command]
pub fn extract_direct_stream(
    state: State<'_, AppState>,
    url: String,
) -> crate::adblock::StreamExtractionResult {
    state.adblock.extract_direct_stream(&url)
}


// Los comandos de la API de plugins viven en un módulo por dominio.
pub use crate::plugin_commands::*;
