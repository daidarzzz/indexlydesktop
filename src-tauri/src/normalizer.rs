// src-tauri/src/normalizer.rs — Motor de normalización e ingesta universal
use crate::models::{AutoMappingResult, MappingConfig, PackageInfo, Source, UnifiedItem};
use deunicode::deunicode;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

const TITLE_KEYS: &[&str] = &["title", "titulo", "título", "name", "nombre", "label", "subject", "headline"];
const LINK_KEYS: &[&str] = &["uris", "uri", "url", "link", "enlace", "magnet", "href", "downloadurl", "download_url"];
const SIZE_KEYS: &[&str] = &["filesize", "size", "tamaño", "tamano", "peso", "bytes", "length"];

pub fn is_link_value(s: &str) -> bool {
    let t = s.trim().to_lowercase();
    t.starts_with("http://") || t.starts_with("https://") || t.starts_with("magnet:") || t.starts_with("ftp://")
}

pub fn normalize_text(s: &str) -> String {
    deunicode(s).to_lowercase().trim().to_string()
}

pub fn sanitize_slug(s: &str) -> String {
    let clean: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    clean.trim_matches('-').to_lowercase()
}

pub struct ParsedEnvelopeSource {
    pub source: Source,
    pub items: Vec<UnifiedItem>,
    pub raw_content: Option<String>,
}

/// Detecta si un JSON es un envelope v2 de IndexLy: `{ "v": 2, "s": [ ... ] }`
pub fn parse_v2_envelope(val: &Value, fallback_pkg_slug: &str, fallback_pkg_name: &str) -> Option<Vec<ParsedEnvelopeSource>> {
    let obj = val.as_object()?;
    let version = obj.get("v").and_then(|v| v.as_u64())?;
    if version != 2 {
        return None;
    }
    let sources_arr = obj.get("s").and_then(|s| s.as_array())?;

    let mut result = Vec::new();
    let is_multi = sources_arr.len() > 1;

    for s_val in sources_arr.iter() {
        let s_obj = match s_val.as_object() {
            Some(o) => o,
            None => continue,
        };

        let name = s_obj
            .get("n")
            .and_then(|n| n.as_str())
            .unwrap_or("Fuente")
            .trim()
            .to_string();

        let active = s_obj.get("a").and_then(|a| a.as_bool()).unwrap_or(true);

        // Parse package metadata si existe en s_obj["p"] = [slug, name?, version?, r2Url?]
        let pkg = if let Some(p_val) = s_obj.get("p") {
            if let Some(arr) = p_val.as_array() {
                arr.first().and_then(|slug_val| slug_val.as_str()).map(|slug| {
                    let pkg_name = arr.get(1).and_then(|n| n.as_str()).unwrap_or(slug);
                    PackageInfo {
                        slug: slug.to_string(),
                        name: Some(pkg_name.to_string()),
                    }
                })
            } else if let Some(p_obj) = p_val.as_object() {
                p_obj.get("slug").and_then(|s| s.as_str()).map(|slug| {
                    let pkg_name = p_obj.get("name").and_then(|n| n.as_str()).unwrap_or(slug);
                    PackageInfo {
                        slug: slug.to_string(),
                        name: Some(pkg_name.to_string()),
                    }
                })
            } else {
                None
            }
        } else if is_multi {
            // Si el archivo trae varias fuentes pero no declara p, agruparlas bajo el nombre del archivo
            Some(PackageInfo {
                slug: sanitize_slug(fallback_pkg_slug),
                name: Some(fallback_pkg_name.to_string()),
            })
        } else {
            None
        };

        // Parse mapping si existe en s_obj["m"] = [titleKey, linkKey?, subtitleKey?]
        let mapping = s_obj.get("m").and_then(|m_val| {
            m_val.as_array().map(|arr| MappingConfig {
                title_key: arr.first().and_then(|v| v.as_str()).map(|s| s.to_string()),
                link_key: arr.get(1).and_then(|v| v.as_str()).map(|s| s.to_string()),
                subtitle_key: arr.get(2).and_then(|v| v.as_str()).map(|s| s.to_string()),
            })
        });

        let source_id = Uuid::new_v4().to_string();
        let d_val = s_obj.get("d").unwrap_or(s_val);

        // Comprobar si `d` es tabular: `{ "k": [...], "v": [...] }`
        let items = if let Some(d_obj) = d_val.as_object() {
            if let (Some(Value::Array(k_arr)), Some(Value::Array(v_arr))) = (d_obj.get("k"), d_obj.get("v")) {
                let columns: Vec<String> = k_arr.iter().filter_map(|k| k.as_str().map(|s| s.to_string())).collect();
                parse_tabular_items(&columns, v_arr, &source_id, &name, mapping.as_ref())
            } else {
                normalize_json_to_items(d_val, &source_id, &name, mapping.as_ref())
            }
        } else {
            normalize_json_to_items(d_val, &source_id, &name, mapping.as_ref())
        };

        let count = items.len();
        result.push(ParsedEnvelopeSource {
            source: Source {
                id: source_id,
                name,
                active,
                count,
                mapping,
                pkg,
                flags: None,
            },
            items,
            raw_content: Some(s_val.to_string()),
        });
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// Ingesta ultrarrápida de datos tabulares (formato nativo de compresión de IndexLy)
pub fn parse_tabular_items(
    columns: &[String],
    rows: &[Value],
    source_id: &str,
    source_name: &str,
    mapping: Option<&MappingConfig>,
) -> Vec<UnifiedItem> {
    let lower_cols: Vec<String> = columns.iter().map(|c| c.to_lowercase()).collect();

    let mut custom_title = None;
    let mut custom_link = None;
    let mut custom_sub = None;

    if let Some(m) = mapping {
        if let Some(ref tk) = m.title_key {
            let ltk = tk.to_lowercase();
            custom_title = lower_cols.iter().position(|c| c == &ltk);
        }
        if let Some(ref lk) = m.link_key {
            let llk = lk.to_lowercase();
            custom_link = lower_cols.iter().position(|c| c == &llk);
        }
        if let Some(ref sk) = m.subtitle_key {
            let lsk = sk.to_lowercase();
            custom_sub = lower_cols.iter().position(|c| c == &lsk);
        }
    }

    // Localizar índices de columnas críticas
    let title_idx = custom_title.unwrap_or_else(|| {
        lower_cols
            .iter()
            .position(|c| TITLE_KEYS.contains(&c.as_str()))
            .unwrap_or(0)
    });

    let link_idx = custom_link.or_else(|| {
        lower_cols
            .iter()
            .position(|c| LINK_KEYS.contains(&c.as_str()))
    });

    let size_idx = lower_cols
        .iter()
        .position(|c| SIZE_KEYS.contains(&c.as_str()));

    let date_idx = custom_sub.or_else(|| {
        lower_cols
            .iter()
            .position(|c| c.contains("date") || c.contains("fecha"))
    });

    let mut items = Vec::with_capacity(rows.len());

    for (row_idx, row_val) in rows.iter().enumerate() {
        let row = match row_val.as_array() {
            Some(r) => r,
            None => continue,
        };

        let title = row
            .get(title_idx)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if title.is_empty() {
            continue;
        }

        let link = link_idx.and_then(|idx| {
            row.get(idx).and_then(|v| match v {
                Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
                Value::Array(a) => a.first().and_then(|u| u.as_str()).map(|s| s.to_string()),
                _ => None,
            })
        });

        let file_size = size_idx.and_then(|idx| {
            row.get(idx).and_then(|v| match v {
                Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
                Value::Number(n) => Some(format!("{} MB", n.as_u64().unwrap_or(0) / (1024 * 1024))),
                _ => None,
            })
        });

        let subtitle = date_idx.and_then(|idx| {
            row.get(idx).and_then(|v| v.as_str()).map(|s| {
                if s.len() >= 10 {
                    s[..10].to_string()
                } else {
                    s.to_string()
                }
            })
        });

        let file_size_bytes = crate::db::parse_file_size_bytes(file_size.as_deref());

        items.push(UnifiedItem {
            id: format!("{}:{}", source_id, row_idx),
            source_id: source_id.to_string(),
            source_name: source_name.to_string(),
            title,
            subtitle,
            file_size,
            file_size_bytes,
            link,
            raw: None,
        });
    }

    items
}

pub fn detect_array(val: &Value) -> Option<(&Vec<Value>, Option<String>)> {
    if let Value::Array(arr) = val {
        return Some((arr, None));
    }
    if let Value::Object(map) = val {
        let priority = [
            "downloads", "items", "results", "data", "entries", "list",
            "streams", "channels", "videos", "media", "links",
            "games", "books", "movies", "records", "rows",
        ];
        for k in priority {
            if let Some(Value::Array(arr)) = map.get(k) {
                return Some((arr, Some(k.to_string())));
            }
        }
        let mut best: Option<&Vec<Value>> = None;
        let mut best_key: Option<String> = None;
        let mut fallback_arr: Option<&Vec<Value>> = None;
        let mut fallback_key: Option<String> = None;

        for (k, v) in map {
            if let Value::Array(arr) = v {
                if !arr.is_empty() {
                    if arr[0].is_object() {
                        if best.is_none() || arr.len() > best.unwrap().len() {
                            best = Some(arr);
                            best_key = Some(k.clone());
                        }
                    } else if fallback_arr.is_none() || arr.len() > fallback_arr.unwrap().len() {
                        fallback_arr = Some(arr);
                        fallback_key = Some(k.clone());
                    }
                }
            }
        }
        if let Some(arr) = best {
            return Some((arr, best_key));
        }
        if let Some(arr) = fallback_arr {
            return Some((arr, fallback_key));
        }

        for (k2, v) in map {
            if let Value::Object(submap) = v {
                for (subk, subv) in submap {
                    if let Value::Array(arr) = subv {
                        if !arr.is_empty() && arr[0].is_object() {
                            return Some((arr, Some(format!("{}.{}", k2, subk))));
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn get_available_keys(val: &Value) -> Vec<String> {
    // FIX BUG 7: Si es formato tabular con k
    if let Value::Object(obj) = val {
        let k_opt = obj.get("k").or_else(|| obj.get("keys")).and_then(|v| v.as_array());
        if let Some(k_arr) = k_opt {
            let cols: Vec<String> = k_arr.iter().filter_map(|k| k.as_str().map(|s| s.to_string())).collect();
            if !cols.is_empty() {
                return cols;
            }
        }
    }

    if let Some((arr, _)) = detect_array(val) {
        if let Some(Value::Object(map)) = arr.iter().find(|x| x.is_object()) {
            return map.keys().cloned().collect();
        }
    }
    if let Value::Object(map) = val {
        // Si es un objeto de objetos (ej: { "ch1": { "name": ..., "url": ... }, "ch2": ... })
        if let Some(Value::Object(inner_map)) = map.values().find(|v| v.is_object()) {
            return inner_map.keys().cloned().collect();
        }
        return map.keys().cloned().collect();
    }
    Vec::new()
}

pub fn get_auto_mapping(val: &Value) -> AutoMappingResult {
    let available_keys = get_available_keys(val);
    let mut title_key = None;
    let mut link_key = None;
    let mut subtitle_key = None;

    // FIX BUG 7: Detectar formato tabular comprimido { "k": [...], "v": [...] }
    if let Value::Object(obj) = val {
        let k_opt = obj.get("k").or_else(|| obj.get("keys")).and_then(|v| v.as_array());
        let v_opt = obj.get("v").or_else(|| obj.get("values")).and_then(|v| v.as_array());
        if let (Some(k_arr), Some(v_arr)) = (k_opt, v_opt) {
            let columns: Vec<String> = k_arr.iter().filter_map(|k| k.as_str().map(|s| s.to_string())).collect();
            for col in &columns {
                let lk = col.to_lowercase();
                if title_key.is_none() && TITLE_KEYS.contains(&lk.as_str()) {
                    title_key = Some(col.clone());
                }
                if link_key.is_none() && LINK_KEYS.contains(&lk.as_str()) {
                    link_key = Some(col.clone());
                }
                if subtitle_key.is_none() && (lk.contains("desc") || lk.contains("category") || lk.contains("genre") || lk.contains("year") || lk.contains("date")) {
                    subtitle_key = Some(col.clone());
                }
            }
            return AutoMappingResult {
                available_keys: columns,
                mapping: MappingConfig {
                    title_key,
                    link_key,
                    subtitle_key,
                },
                preview_count: v_arr.len(),
            };
        }
    }

    if let Some((arr, _)) = detect_array(val) {
        if let Some(Value::Object(map)) = arr.iter().find(|x| x.is_object()) {
            let lower_keys: HashMap<String, String> = map.keys().map(|k| (k.to_lowercase(), k.clone())).collect();

            for cand in TITLE_KEYS {
                if let Some(original) = lower_keys.get(*cand) {
                    title_key = Some(original.clone());
                    break;
                }
            }
            if title_key.is_none() {
                for (k, v) in map {
                    if let Value::String(s) = v {
                        let len = s.trim().len();
                        if (2..=200).contains(&len) {
                            let lk = k.to_lowercase();
                            if !LINK_KEYS.contains(&lk.as_str()) && !SIZE_KEYS.contains(&lk.as_str()) {
                                title_key = Some(k.clone());
                                break;
                            }
                        }
                    }
                }
            }

            for cand in LINK_KEYS {
                if let Some(original) = lower_keys.get(*cand) {
                    if let Some(v) = map.get(original) {
                        if let Value::Array(uris) = v {
                            if let Some(Value::String(u)) = uris.first() {
                                if is_link_value(u) {
                                    link_key = Some(original.clone());
                                    break;
                                }
                            }
                        } else if let Value::String(u) = v {
                            if is_link_value(u) {
                                link_key = Some(original.clone());
                                break;
                            }
                        }
                    }
                }
            }

            for cand in &["description", "descripcion", "desc", "category", "categoria", "genre", "year", "año"] {
                if let Some(original) = lower_keys.get(*cand) {
                    subtitle_key = Some(original.clone());
                    break;
                }
            }
        }
    }

    let preview_count = detect_array(val).map(|(arr, _)| arr.len()).unwrap_or(0);

    AutoMappingResult {
        available_keys,
        mapping: MappingConfig {
            title_key,
            link_key,
            subtitle_key,
        },
        preview_count,
    }
}

pub fn normalize_json_to_items(
    val: &Value,
    source_id: &str,
    source_name: &str,
    mapping: Option<&MappingConfig>,
) -> Vec<UnifiedItem> {
    // FIX BUG 7: Si es un JSON tabular standalone { "k": [...], "v": [...] }
    if let Value::Object(obj) = val {
        let k_opt = obj.get("k").or_else(|| obj.get("keys")).and_then(|v| v.as_array());
        let v_opt = obj.get("v").or_else(|| obj.get("values")).and_then(|v| v.as_array());
        if let (Some(k_arr), Some(v_arr)) = (k_opt, v_opt) {
            let columns: Vec<String> = k_arr.iter().filter_map(|k| k.as_str().map(|s| s.to_string())).collect();
            return parse_tabular_items(&columns, v_arr, source_id, source_name, mapping);
        }
    }

    let mut items = Vec::new();
    let auto = get_auto_mapping(val);
    let title_k = mapping.and_then(|m| m.title_key.as_deref()).or(auto.mapping.title_key.as_deref());
    let link_k = mapping.and_then(|m| m.link_key.as_deref()).or(auto.mapping.link_key.as_deref());
    let sub_k = mapping.and_then(|m| m.subtitle_key.as_deref()).or(auto.mapping.subtitle_key.as_deref());

    if let Some((arr, _)) = detect_array(val) {
        for (idx, item) in arr.iter().enumerate() {
            if let Value::Object(obj) = item {
                let title = title_k
                    .and_then(|k| obj.get(k))
                    .and_then(|v| v.as_str())
                    .unwrap_or_else(|| {
                        TITLE_KEYS.iter()
                            .find_map(|&k| obj.get(k).and_then(|v| v.as_str()))
                            .unwrap_or("Sin título")
                    })
                    .trim()
                    .to_string();

                if title.is_empty() {
                    continue;
                }

                let link = link_k
                    .and_then(|k| obj.get(k))
                    .and_then(|v| match v {
                        Value::String(s) => Some(s.clone()),
                        Value::Array(a) => a.first().and_then(|u| u.as_str()).map(|s| s.to_string()),
                        _ => None,
                    })
                    .or_else(|| {
                        LINK_KEYS.iter().find_map(|&k| {
                            obj.get(k).and_then(|v| match v {
                                Value::String(s) if is_link_value(s) => Some(s.clone()),
                                Value::Array(a) => a.first().and_then(|u| u.as_str()).filter(|u| is_link_value(u)).map(|s| s.to_string()),
                                _ => None,
                            })
                        })
                    });

                let subtitle = sub_k
                    .and_then(|k| obj.get(k))
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                let file_size = SIZE_KEYS.iter().find_map(|&k| {
                    obj.get(k).and_then(|v| match v {
                        Value::String(s) => Some(s.clone()),
                        Value::Number(n) => Some(format!("{} MB", n.as_u64().unwrap_or(0) / (1024 * 1024))),
                        _ => None,
                    })
                });

                let file_size_bytes = crate::db::parse_file_size_bytes(file_size.as_deref());

                items.push(UnifiedItem {
                    id: format!("{}:{}", source_id, idx),
                    source_id: source_id.to_string(),
                    source_name: source_name.to_string(),
                    title,
                    subtitle,
                    file_size,
                    file_size_bytes,
                    link,
                    raw: Some(item.to_string()),
                });
            } else if let Value::String(s) = item {
                let title = s.trim().to_string();
                if !title.is_empty() {
                    items.push(UnifiedItem {
                        id: format!("{}:{}", source_id, idx),
                        source_id: source_id.to_string(),
                        source_name: source_name.to_string(),
                        title,
                        subtitle: None,
                        file_size: None,
                        file_size_bytes: None,
                        link: None,
                        raw: None,
                    });
                }
            }
        }
    }

    if items.is_empty() {
        if let Value::Object(map) = val {
            for (idx, (key, item)) in map.iter().enumerate() {
                if let Value::Object(obj) = item {
                    let title = title_k
                        .and_then(|k| obj.get(k))
                        .and_then(|v| v.as_str())
                        .unwrap_or_else(|| {
                            TITLE_KEYS.iter()
                                .find_map(|&k| obj.get(k).and_then(|v| v.as_str()))
                                .unwrap_or(key)
                        })
                        .trim()
                        .to_string();

                    if title.is_empty() {
                        continue;
                    }

                    let link = link_k
                        .and_then(|k| obj.get(k))
                        .and_then(|v| match v {
                            Value::String(s) => Some(s.clone()),
                            Value::Array(a) => a.first().and_then(|u| u.as_str()).map(|s| s.to_string()),
                            _ => None,
                        })
                        .or_else(|| {
                            LINK_KEYS.iter().find_map(|&k| {
                                obj.get(k).and_then(|v| match v {
                                    Value::String(s) if is_link_value(s) => Some(s.clone()),
                                    Value::Array(a) => a.first().and_then(|u| u.as_str()).filter(|u| is_link_value(u)).map(|s| s.to_string()),
                                    _ => None,
                                })
                            })
                        });

                    let subtitle = sub_k
                        .and_then(|k| obj.get(k))
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());

                    let file_size = SIZE_KEYS.iter().find_map(|&k| {
                        obj.get(k).and_then(|v| match v {
                            Value::String(s) => Some(s.clone()),
                            Value::Number(n) => Some(format!("{} MB", n.as_u64().unwrap_or(0) / (1024 * 1024))),
                            _ => None,
                        })
                    });

                    let file_size_bytes = crate::db::parse_file_size_bytes(file_size.as_deref());

                    items.push(UnifiedItem {
                        id: format!("{}:{}", source_id, idx),
                        source_id: source_id.to_string(),
                        source_name: source_name.to_string(),
                        title,
                        subtitle,
                        file_size,
                        file_size_bytes,
                        link,
                        raw: Some(item.to_string()),
                    });
                }
            }
        }
    }

    items
}

/// FIX BUG 6: Ingesta de CSV con MappingConfig dinámico para mapear columnas arbitrarias
pub fn parse_csv_to_items(
    content: &str,
    delimiter: u8,
    source_id: &str,
    source_name: &str,
    mapping: Option<&MappingConfig>,
) -> Vec<UnifiedItem> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(content.as_bytes());

    let headers = match rdr.headers() {
        Ok(h) => h.clone(),
        Err(_) => return Vec::new(),
    };

    let title_idx = mapping
        .and_then(|m| m.title_key.as_deref())
        .and_then(|tk| headers.iter().position(|h| h.eq_ignore_ascii_case(tk)))
        .or_else(|| headers.iter().position(|h| TITLE_KEYS.contains(&h.to_lowercase().as_str())))
        .unwrap_or(0);

    let link_idx = mapping
        .and_then(|m| m.link_key.as_deref())
        .and_then(|lk| headers.iter().position(|h| h.eq_ignore_ascii_case(lk)))
        .or_else(|| headers.iter().position(|h| LINK_KEYS.contains(&h.to_lowercase().as_str())));

    let subtitle_idx = mapping
        .and_then(|m| m.subtitle_key.as_deref())
        .and_then(|sk| headers.iter().position(|h| h.eq_ignore_ascii_case(sk)));

    let size_idx = headers.iter().position(|h| SIZE_KEYS.contains(&h.to_lowercase().as_str()));

    let mut items = Vec::new();
    for (i, result) in rdr.records().enumerate() {
        if let Ok(rec) = result {
            let title = rec.get(title_idx).unwrap_or("").trim().to_string();
            if title.is_empty() {
                continue;
            }
            let link = link_idx.and_then(|idx| rec.get(idx)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            let subtitle = subtitle_idx.and_then(|idx| rec.get(idx)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            let file_size = size_idx.and_then(|idx| rec.get(idx)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            let file_size_bytes = crate::db::parse_file_size_bytes(file_size.as_deref());

            items.push(UnifiedItem {
                id: format!("{}:{}", source_id, i),
                source_id: source_id.to_string(),
                source_name: source_name.to_string(),
                title,
                subtitle,
                file_size,
                file_size_bytes,
                link,
                raw: None,
            });
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_v2_envelope_tabular() {
        let envelope = json!({
            "v": 2,
            "s": [
                {
                    "n": "onlinefix",
                    "d": {
                        "k": ["uris", "title", "fileSize", "uploadDate"],
                        "v": [
                            [["magnet:?xt=urn:btih:123"], "Among Us 2026", "694 MB", "2026-08-26"],
                            [["magnet:?xt=urn:btih:456"], "Bodycam", "36 GB", "2026-08-26"]
                        ]
                    }
                },
                {
                    "n": "FitGirl",
                    "d": {
                        "k": ["uris", "title", "fileSize"],
                        "v": [
                            [["magnet:?xt=urn:btih:789"], "Elden Ring", "45 GB"]
                        ]
                    }
                }
            ]
        });

        let parsed = parse_v2_envelope(&envelope, "gamepack-1", "gamepack-1").unwrap();
        assert_eq!(parsed.len(), 2);

        // Fuente 1
        assert_eq!(parsed[0].source.name, "onlinefix");
        assert_eq!(parsed[0].items.len(), 2);
        assert_eq!(parsed[0].items[0].title, "Among Us 2026");
        assert_eq!(parsed[0].items[0].file_size.as_deref(), Some("694 MB"));
        assert_eq!(parsed[0].items[0].link.as_deref(), Some("magnet:?xt=urn:btih:123"));
        assert_eq!(parsed[0].source.pkg.as_ref().unwrap().slug, "gamepack-1");

        // Fuente 2
        assert_eq!(parsed[1].source.name, "FitGirl");
        assert_eq!(parsed[1].items.len(), 1);
        assert_eq!(parsed[1].items[0].title, "Elden Ring");
    }

    #[test]
    fn test_csv_with_custom_mapping() {
        let csv_content = "juego_nombre;enlace_descarga;peso;sinopsis\nDoom Eternal;https://example.com/doom;38 GB;Shooter infernal\nHades 2;https://example.com/hades;4 GB;Roguelike divino";
        let mapping = MappingConfig {
            title_key: Some("juego_nombre".to_string()),
            link_key: Some("enlace_descarga".to_string()),
            subtitle_key: Some("sinopsis".to_string()),
        };

        let items = parse_csv_to_items(csv_content, b';', "src_csv", "CSV Source", Some(&mapping));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Doom Eternal");
        assert_eq!(items[0].link.as_deref(), Some("https://example.com/doom"));
        assert_eq!(items[0].subtitle.as_deref(), Some("Shooter infernal"));
        assert_eq!(items[0].file_size.as_deref(), Some("38 GB"));
        assert_eq!(items[0].file_size_bytes, Some(38 * 1024 * 1024 * 1024));

        assert_eq!(items[1].title, "Hades 2");
        assert_eq!(items[1].file_size_bytes, Some(4 * 1024 * 1024 * 1024));
    }

    #[test]
    fn test_standalone_tabular_json() {
        let tabular_json = json!({
            "k": ["nombre", "magnet_url", "tamano"],
            "v": [
                ["Silksong", "magnet:?xt=urn:btih:silk", "9 GB"],
                ["Crowsworn", "magnet:?xt=urn:btih:crow", "5 GB"]
            ]
        });

        let mapping = MappingConfig {
            title_key: Some("nombre".to_string()),
            link_key: Some("magnet_url".to_string()),
            subtitle_key: None,
        };

        let items = normalize_json_to_items(&tabular_json, "src_tab", "Tabular Source", Some(&mapping));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Silksong");
        assert_eq!(items[0].link.as_deref(), Some("magnet:?xt=urn:btih:silk"));
        assert_eq!(items[0].file_size.as_deref(), Some("9 GB"));
        assert_eq!(items[0].file_size_bytes, Some(9 * 1024 * 1024 * 1024));
    }

    #[test]
    fn test_benchmark_gamepack_1_if_present() {
        let path = std::path::Path::new("C:/Users/david/Downloads/gamepack-1.json");
        if !path.exists() {
            return;
        }
        let start = std::time::Instant::now();
        let content = std::fs::read_to_string(path).unwrap();
        let json_val: Value = serde_json::from_str(&content).unwrap();
        let parse_time = start.elapsed();

        let start_unpack = std::time::Instant::now();
        let sources = parse_v2_envelope(&json_val, "gamepack-1", "gamepack-1").unwrap();
        let unpack_time = start_unpack.elapsed();

        let total_items: usize = sources.iter().map(|s| s.items.len()).sum();
        println!(
            "\n>>> BENCHMARK GAMEPACK-1: 5 fuentes, {} items. JSON parse: {:?}, Tabular Unpack: {:?}, Total: {:?}",
            total_items, parse_time, unpack_time, start.elapsed()
        );

        assert_eq!(sources.len(), 5);
        assert_eq!(total_items, 23601);
    }
}

