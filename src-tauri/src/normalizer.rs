// src-tauri/src/normalizer.rs — Motor de normalización e ingesta universal
//
// Formatos soportados:
//   · JSON: array raíz, array bajo una clave ("items", "data"…), objeto de objetos,
//     tabular compacto { "k": [...], "v": [[...]] } y envelopes v2 de IndexLy.
//   · JSONL / NDJSON: un objeto JSON por línea.
//   · CSV / TSV / ";" / "|": separador detectado o elegido, con o sin cabecera.
//   · Texto plano: una línea por elemento; si la línea contiene un enlace se separa.
//
// Las claves del mapeo admiten rutas anidadas: "info.title", "links[0].url", "a.0.b".
use crate::models::{AutoMappingResult, ImportPreview, MappingConfig, PackageInfo, Source, UnifiedItem};
use deunicode::deunicode;
use serde_json::Value;
use uuid::Uuid;

const TITLE_KEYS: &[&str] = &["title", "titulo", "título", "name", "nombre", "label", "subject", "headline"];
const LINK_KEYS: &[&str] = &["uris", "uri", "url", "link", "enlace", "magnet", "href", "downloadurl", "download_url"];
const SIZE_KEYS: &[&str] = &["filesize", "file_size", "size", "tamaño", "tamano", "peso", "bytes", "length"];
const SUBTITLE_KEYS: &[&str] = &[
    "description", "descripcion", "descripción", "desc", "subtitle", "subtitulo", "category", "categoria",
    "categoría", "genre", "genero", "género", "year", "año", "author", "autor", "artist", "artista",
];

/// Filas que se devuelven en la vista previa de importación.
const PREVIEW_ROWS: usize = 8;

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

// ---------------------------------------------------------------------------
// Utilidades de valores y rutas
// ---------------------------------------------------------------------------

/// Lee un valor por ruta: "a.b", "links[0].url" o "a.0.b". Primero intenta la clave
/// literal (por si contiene puntos) y, en objetos, sin distinguir mayúsculas.
pub fn get_path<'a>(val: &'a Value, path: &str) -> Option<&'a Value> {
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    if let Value::Object(map) = val {
        if let Some(v) = map.get(path) {
            return Some(v);
        }
    }

    let mut cur = val;
    for raw_seg in path.split('.') {
        // "links[0]" → "links", 0
        let (name, indexes) = split_indexes(raw_seg);
        if !name.is_empty() {
            cur = match cur {
                Value::Object(map) => map
                    .get(name)
                    .or_else(|| map.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v))?,
                Value::Array(arr) => arr.get(name.parse::<usize>().ok()?)?,
                _ => return None,
            };
        }
        for i in indexes {
            cur = cur.as_array()?.get(i)?;
        }
    }
    Some(cur)
}

fn split_indexes(seg: &str) -> (&str, Vec<usize>) {
    match seg.find('[') {
        None => (seg, Vec::new()),
        Some(pos) => {
            let name = &seg[..pos];
            let idx = seg[pos..]
                .split(|c| c == '[' || c == ']')
                .filter(|s| !s.is_empty())
                .filter_map(|s| s.parse::<usize>().ok())
                .collect();
            (name, idx)
        }
    }
}

/// Texto legible de un valor: cadenas, números, booleanos o el primer elemento de un array.
pub fn value_to_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => {
            let t = s.trim();
            (!t.is_empty()).then(|| t.to_string())
        }
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Array(a) => a.iter().find_map(value_to_text),
        _ => None,
    }
}

/// Tamaño legible a partir de bytes (1536 → "1.5 KB").
pub fn human_size(bytes: f64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = bytes.max(0.0);
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    if u == 0 || v >= 100.0 {
        format!("{:.0} {}", v, UNITS[u])
    } else {
        format!("{:.1} {}", v, UNITS[u])
    }
}

/// Tamaño de un valor: los números se interpretan como bytes; el texto se respeta.
fn size_from_value(v: &Value) -> Option<String> {
    match v {
        Value::Number(n) => n.as_f64().map(human_size),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else if let Ok(n) = t.parse::<f64>() {
                Some(human_size(n))
            } else {
                Some(t.to_string())
            }
        }
        Value::Array(a) => a.iter().find_map(size_from_value),
        _ => None,
    }
}

fn link_from_value(v: &Value, require_link: bool) -> Option<String> {
    match v {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() || (require_link && !is_link_value(t)) {
                None
            } else {
                Some(t.to_string())
            }
        }
        Value::Array(a) => a.iter().find_map(|x| link_from_value(x, require_link)),
        _ => None,
    }
}

fn mapping_key<'a>(m: Option<&'a MappingConfig>, f: fn(&'a MappingConfig) -> &'a Option<String>) -> Option<&'a str> {
    m.and_then(|m| f(m).as_deref()).map(str::trim).filter(|s| !s.is_empty())
}

/// Recorre un objeto de muestra y devuelve sus rutas utilizables (hasta 3 niveles).
pub fn collect_paths(val: &Value) -> Vec<String> {
    fn walk(v: &Value, prefix: &str, depth: usize, out: &mut Vec<String>) {
        match v {
            Value::Object(map) => {
                for (k, child) in map {
                    let path = if prefix.is_empty() { k.clone() } else { format!("{}.{}", prefix, k) };
                    let nested = match child {
                        Value::Object(m) => !m.is_empty(),
                        Value::Array(a) => a.first().map(|f| f.is_object()).unwrap_or(false),
                        _ => false,
                    };
                    if nested && depth < 3 {
                        walk(child, &path, depth + 1, out);
                    } else {
                        out.push(path);
                    }
                }
            }
            Value::Array(arr) => {
                if let Some(first) = arr.first() {
                    walk(first, &format!("{}[0]", prefix), depth, out);
                }
            }
            _ => {
                if !prefix.is_empty() {
                    out.push(prefix.to_string());
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(val, "", 0, &mut out);
    out
}

// ---------------------------------------------------------------------------
// Envelope v2
// ---------------------------------------------------------------------------

/// Detecta si un JSON es un envelope v2 de IndexLy: `{ "v": 2, "s": [ ... ] }`
pub fn parse_v2_envelope(val: &Value, fallback_pkg_slug: &str, fallback_pkg_name: &str) -> Option<Vec<ParsedEnvelopeSource>> {
    let obj = val.as_object()?;
    let version = obj.get("v").and_then(|v| v.as_u64())?;
    if version != 2 {
        return None;
    }
    let sources_arr = obj.get("s").and_then(|s| s.as_array())?;

    let mut result = Vec::new();
    // "g": false (exportaciones de IndexLy) → no agrupar fuentes sueltas en un paquete
    let group_loose = obj.get("g").and_then(|g| g.as_bool()).unwrap_or(true);
    let is_multi = sources_arr.len() > 1 && group_loose;

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

        // Paquete en s_obj["p"] = [slug, name?, version?, r2Url?] o { slug, name }
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
            // Varias fuentes sin "p": se agrupan bajo el nombre del archivo
            Some(PackageInfo {
                slug: sanitize_slug(fallback_pkg_slug),
                name: Some(fallback_pkg_name.to_string()),
            })
        } else {
            None
        };

        // Mapeo en s_obj["m"] = [titleKey, linkKey?, subtitleKey?, sizeKey?]
        let mapping = s_obj.get("m").and_then(|m_val| {
            m_val.as_array().map(|arr| {
                let at = |i: usize| arr.get(i).and_then(|v| v.as_str()).map(|s| s.to_string());
                MappingConfig {
                    title_key: at(0),
                    link_key: at(1),
                    subtitle_key: at(2),
                    size_key: at(3),
                    ..Default::default()
                }
            })
        });

        let source_id = Uuid::new_v4().to_string();
        let d_val = s_obj.get("d").unwrap_or(s_val);
        let items = normalize_json_to_items(d_val, &source_id, &name, mapping.as_ref());

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

/// Columnas y filas de un JSON tabular `{ "k": [...], "v": [[...]] }`.
fn as_tabular(val: &Value) -> Option<(Vec<String>, &Vec<Value>)> {
    let obj = val.as_object()?;
    let k_arr = obj.get("k").or_else(|| obj.get("keys"))?.as_array()?;
    let v_arr = obj.get("v").or_else(|| obj.get("values"))?.as_array()?;
    let columns: Vec<String> = k_arr.iter().filter_map(|k| k.as_str().map(|s| s.to_string())).collect();
    if columns.is_empty() {
        return None;
    }
    Some((columns, v_arr))
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
    let find = |key: Option<&str>| key.and_then(|k| lower_cols.iter().position(|c| c == &k.to_lowercase()));

    let custom_title = find(mapping_key(mapping, |m| &m.title_key));
    let custom_link = find(mapping_key(mapping, |m| &m.link_key));
    let custom_sub = find(mapping_key(mapping, |m| &m.subtitle_key));
    let custom_size = find(mapping_key(mapping, |m| &m.size_key));

    let title_idx = custom_title.unwrap_or_else(|| {
        lower_cols.iter().position(|c| TITLE_KEYS.contains(&c.as_str())).unwrap_or(0)
    });
    let link_idx = custom_link.or_else(|| lower_cols.iter().position(|c| LINK_KEYS.contains(&c.as_str())));
    let size_idx = custom_size.or_else(|| lower_cols.iter().position(|c| SIZE_KEYS.contains(&c.as_str())));

    // Subtítulo elegido; si no, una fecha (recortada a AAAA-MM-DD)
    let date_idx = lower_cols.iter().position(|c| c.contains("date") || c.contains("fecha"));
    let sub_idx = custom_sub.or(date_idx);
    let sub_is_auto_date = custom_sub.is_none() && date_idx.is_some();

    let mut items = Vec::with_capacity(rows.len());

    for (row_idx, row_val) in rows.iter().enumerate() {
        let row = match row_val.as_array() {
            Some(r) => r,
            None => continue,
        };

        let title = match row.get(title_idx).and_then(value_to_text) {
            Some(t) => t,
            None => continue,
        };

        let link = link_idx.and_then(|idx| row.get(idx)).and_then(|v| link_from_value(v, false));
        let file_size = size_idx.and_then(|idx| row.get(idx)).and_then(size_from_value);

        let subtitle = sub_idx.and_then(|idx| row.get(idx)).and_then(value_to_text).map(|s| {
            // Recorte por caracteres (nunca por bytes: rompería con acentos o "·")
            if sub_is_auto_date && s.chars().count() > 10 {
                s.chars().take(10).collect()
            } else {
                s
            }
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

// ---------------------------------------------------------------------------
// Detección en JSON
// ---------------------------------------------------------------------------

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

/// Elementos de un JSON: los del array detectado o, si es un objeto de objetos,
/// sus valores (con la clave como título de reserva).
fn json_records(val: &Value) -> Vec<(Option<String>, &Value)> {
    if let Some((arr, _)) = detect_array(val) {
        return arr.iter().map(|v| (None, v)).collect();
    }
    if let Value::Object(map) = val {
        let objs: Vec<(Option<String>, &Value)> = map
            .iter()
            .filter(|(_, v)| v.is_object())
            .map(|(k, v)| (Some(k.clone()), v))
            .collect();
        if !objs.is_empty() {
            return objs;
        }
    }
    Vec::new()
}

pub fn get_available_keys(val: &Value) -> Vec<String> {
    if let Some((columns, _)) = as_tabular(val) {
        return columns;
    }
    if let Some((_, sample)) = json_records(val).into_iter().find(|(_, v)| v.is_object()) {
        return collect_paths(sample);
    }
    if let Value::Object(map) = val {
        return map.keys().cloned().collect();
    }
    Vec::new()
}

/// Elige la primera ruta cuyo nombre (último segmento) coincida con una lista de candidatos.
fn pick_key(paths: &[String], candidates: &[&str], sample: Option<&Value>, accept: impl Fn(&Value) -> bool) -> Option<String> {
    for cand in candidates {
        for p in paths {
            let leaf = p.rsplit('.').next().unwrap_or(p);
            let leaf = leaf.split('[').next().unwrap_or(leaf).to_lowercase();
            if leaf == *cand {
                let ok = sample.and_then(|s| get_path(s, p)).map(&accept).unwrap_or(true);
                if ok {
                    return Some(p.clone());
                }
            }
        }
    }
    None
}

pub fn get_auto_mapping(val: &Value) -> AutoMappingResult {
    // Tabular { "k": [...], "v": [...] }
    if let Some((columns, rows)) = as_tabular(val) {
        let lower: Vec<String> = columns.iter().map(|c| c.to_lowercase()).collect();
        let by = |cands: &[&str]| lower.iter().position(|c| cands.contains(&c.as_str())).map(|i| columns[i].clone());
        let subtitle_key = lower
            .iter()
            .position(|c| SUBTITLE_KEYS.contains(&c.as_str()) || c.contains("date") || c.contains("fecha"))
            .map(|i| columns[i].clone());
        return AutoMappingResult {
            mapping: MappingConfig {
                title_key: by(TITLE_KEYS),
                link_key: by(LINK_KEYS),
                subtitle_key,
                size_key: by(SIZE_KEYS),
                ..Default::default()
            },
            available_keys: columns,
            preview_count: rows.len(),
        };
    }

    let records = json_records(val);
    let sample = records.iter().find(|(_, v)| v.is_object()).map(|(_, v)| *v);
    let available_keys = sample.map(collect_paths).unwrap_or_else(|| get_available_keys(val));

    let title_key = pick_key(&available_keys, TITLE_KEYS, sample, |v| value_to_text(v).is_some()).or_else(|| {
        // Sin nombre conocido: el primer texto corto que no sea enlace ni tamaño
        sample.and_then(|s| {
            available_keys.iter().find(|p| {
                let leaf = p.rsplit('.').next().unwrap_or(p).to_lowercase();
                !LINK_KEYS.contains(&leaf.as_str())
                    && !SIZE_KEYS.contains(&leaf.as_str())
                    && matches!(get_path(s, p), Some(Value::String(t)) if (2..=200).contains(&t.trim().len()) && !is_link_value(t))
            })
            .cloned()
        })
    });

    let link_key = pick_key(&available_keys, LINK_KEYS, sample, |v| link_from_value(v, true).is_some()).or_else(|| {
        // Cualquier campo cuyo valor sea un enlace
        sample.and_then(|s| {
            available_keys
                .iter()
                .find(|p| get_path(s, p).and_then(|v| link_from_value(v, true)).is_some())
                .cloned()
        })
    });

    let subtitle_key = pick_key(&available_keys, SUBTITLE_KEYS, sample, |v| value_to_text(v).is_some());
    let size_key = pick_key(&available_keys, SIZE_KEYS, sample, |v| size_from_value(v).is_some());

    AutoMappingResult {
        available_keys,
        mapping: MappingConfig {
            title_key,
            link_key,
            subtitle_key,
            size_key,
            ..Default::default()
        },
        preview_count: records.len(),
    }
}

fn item_from_record(
    rec: &Value,
    fallback_title: Option<&str>,
    keys: &MappingConfig,
    idx: usize,
    source_id: &str,
    source_name: &str,
) -> Option<UnifiedItem> {
    if let Value::String(s) = rec {
        let title = s.trim();
        if title.is_empty() {
            return None;
        }
        return Some(UnifiedItem {
            id: format!("{}:{}", source_id, idx),
            source_id: source_id.to_string(),
            source_name: source_name.to_string(),
            title: title.to_string(),
            subtitle: None,
            file_size: None,
            file_size_bytes: None,
            link: is_link_value(title).then(|| title.to_string()),
            raw: None,
        });
    }
    if !rec.is_object() {
        return None;
    }

    let by_key = |k: &Option<String>| k.as_deref().and_then(|k| get_path(rec, k));

    let title = by_key(&keys.title_key)
        .and_then(value_to_text)
        .or_else(|| TITLE_KEYS.iter().find_map(|k| get_path(rec, k).and_then(value_to_text)))
        .or_else(|| fallback_title.map(|s| s.to_string()))?;
    if title.trim().is_empty() {
        return None;
    }

    let link = by_key(&keys.link_key)
        .and_then(|v| link_from_value(v, false))
        .or_else(|| LINK_KEYS.iter().find_map(|k| get_path(rec, k).and_then(|v| link_from_value(v, true))));

    let subtitle = by_key(&keys.subtitle_key).and_then(value_to_text);

    let file_size = by_key(&keys.size_key)
        .and_then(size_from_value)
        .or_else(|| SIZE_KEYS.iter().find_map(|k| get_path(rec, k).and_then(size_from_value)));
    let file_size_bytes = crate::db::parse_file_size_bytes(file_size.as_deref());

    Some(UnifiedItem {
        id: format!("{}:{}", source_id, idx),
        source_id: source_id.to_string(),
        source_name: source_name.to_string(),
        title,
        subtitle,
        file_size,
        file_size_bytes,
        link,
        raw: Some(rec.to_string()),
    })
}

pub fn normalize_json_to_items(
    val: &Value,
    source_id: &str,
    source_name: &str,
    mapping: Option<&MappingConfig>,
) -> Vec<UnifiedItem> {
    if let Some((columns, rows)) = as_tabular(val) {
        return parse_tabular_items(&columns, rows, source_id, source_name, mapping);
    }

    // Mapeo elegido + detección automática para lo que falte
    let auto = get_auto_mapping(val).mapping;
    let keys = MappingConfig {
        title_key: mapping_key(mapping, |m| &m.title_key).map(String::from).or(auto.title_key),
        link_key: mapping_key(mapping, |m| &m.link_key).map(String::from).or(auto.link_key),
        subtitle_key: mapping_key(mapping, |m| &m.subtitle_key).map(String::from).or(auto.subtitle_key),
        size_key: mapping_key(mapping, |m| &m.size_key).map(String::from).or(auto.size_key),
        ..Default::default()
    };

    json_records(val)
        .into_iter()
        .enumerate()
        .filter_map(|(idx, (fallback, rec))| item_from_record(rec, fallback.as_deref(), &keys, idx, source_id, source_name))
        .collect()
}

// ---------------------------------------------------------------------------
// JSONL, CSV y texto
// ---------------------------------------------------------------------------

/// JSONL / NDJSON: si (casi) todas las líneas son objetos JSON, se convierten en un array.
pub fn parse_jsonl(content: &str) -> Option<Value> {
    let lines: Vec<&str> = content.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.len() < 2 || !lines[0].starts_with('{') {
        return None;
    }
    let parsed: Vec<Value> = lines.iter().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect();
    // Tolerar alguna línea rota, pero exigir que la gran mayoría sea JSON válido
    if parsed.len() * 10 >= lines.len() * 9 && parsed.iter().all(|v| v.is_object()) {
        Some(Value::Array(parsed))
    } else {
        None
    }
}

/// Detecta el separador mirando las primeras líneas: gana el carácter que aparece
/// un número constante (> 0) de veces en todas ellas.
pub fn sniff_delimiter(content: &str) -> Option<u8> {
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).take(8).collect();
    if lines.len() < 2 {
        return None;
    }
    let mut best: Option<(u8, usize)> = None;
    for d in [b'\t', b';', b',', b'|'] {
        let counts: Vec<usize> = lines.iter().map(|l| count_outside_quotes(l, d as char)).collect();
        let min = *counts.iter().min().unwrap_or(&0);
        if min == 0 {
            continue;
        }
        // Las filas deben tener (casi) las mismas columnas que la cabecera
        let consistent = counts.iter().filter(|&&c| c == counts[0]).count() * 4 >= counts.len() * 3;
        if consistent && best.map(|(_, c)| min > c).unwrap_or(true) {
            best = Some((d, min));
        }
    }
    best.map(|(d, _)| d)
}

fn count_outside_quotes(line: &str, d: char) -> usize {
    let mut in_q = false;
    let mut n = 0;
    for c in line.chars() {
        if c == '"' {
            in_q = !in_q;
        } else if c == d && !in_q {
            n += 1;
        }
    }
    n
}

pub fn delimiter_from_config(m: Option<&MappingConfig>) -> Option<u8> {
    let d = m?.delimiter.as_deref()?;
    match d {
        "\\t" | "\t" | "tab" => Some(b'\t'),
        "," => Some(b','),
        ";" => Some(b';'),
        "|" => Some(b'|'),
        _ => None,
    }
}

fn delimiter_label(d: u8) -> String {
    match d {
        b'\t' => "\\t".to_string(),
        other => (other as char).to_string(),
    }
}

/// Cabeceras y filas de un CSV (sin cabecera: "Columna 1", "Columna 2"…).
fn read_csv(content: &str, delimiter: u8, has_header: bool) -> (Vec<String>, Vec<Vec<String>>) {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(content.as_bytes());

    let mut rows: Vec<Vec<String>> = rdr
        .records()
        .filter_map(|r| r.ok())
        .map(|rec| rec.iter().map(|s| s.trim().to_string()).collect::<Vec<_>>())
        .filter(|r| r.iter().any(|c| !c.is_empty()))
        .collect();

    let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    let headers = if has_header && !rows.is_empty() {
        let mut h = rows.remove(0);
        // Quitar BOM y completar cabeceras vacías
        if let Some(first) = h.first_mut() {
            *first = first.trim_start_matches('\u{feff}').to_string();
        }
        for (i, name) in h.iter_mut().enumerate() {
            if name.is_empty() {
                *name = format!("Columna {}", i + 1);
            }
        }
        while h.len() < width {
            h.push(format!("Columna {}", h.len() + 1));
        }
        h
    } else {
        (1..=width).map(|i| format!("Columna {}", i)).collect()
    };
    (headers, rows)
}

/// Ingesta de CSV/TSV con mapeo de columnas, separador y cabecera configurables.
pub fn parse_csv_to_items(
    content: &str,
    delimiter: u8,
    source_id: &str,
    source_name: &str,
    mapping: Option<&MappingConfig>,
) -> Vec<UnifiedItem> {
    let has_header = mapping.and_then(|m| m.has_header).unwrap_or(true);
    let (headers, rows) = read_csv(content, delimiter, has_header);
    let lower: Vec<String> = headers.iter().map(|h| h.to_lowercase()).collect();
    let find = |key: Option<&str>| key.and_then(|k| lower.iter().position(|h| h == &k.to_lowercase()));

    let title_idx = find(mapping_key(mapping, |m| &m.title_key))
        .or_else(|| lower.iter().position(|h| TITLE_KEYS.contains(&h.as_str())))
        .unwrap_or(0);
    let link_idx = find(mapping_key(mapping, |m| &m.link_key))
        .or_else(|| lower.iter().position(|h| LINK_KEYS.contains(&h.as_str())))
        .or_else(|| {
            // Columna cuyo primer valor sea un enlace
            rows.first().and_then(|r| r.iter().position(|c| is_link_value(c)))
        });
    let subtitle_idx = find(mapping_key(mapping, |m| &m.subtitle_key));
    let size_idx = find(mapping_key(mapping, |m| &m.size_key))
        .or_else(|| lower.iter().position(|h| SIZE_KEYS.contains(&h.as_str())));

    let cell = |row: &Vec<String>, idx: Option<usize>| idx.and_then(|i| row.get(i)).filter(|s| !s.is_empty()).cloned();

    rows.iter()
        .enumerate()
        .filter_map(|(i, row)| {
            let title = cell(row, Some(title_idx))?;
            let file_size = cell(row, size_idx).and_then(|s| size_from_value(&Value::String(s)));
            let file_size_bytes = crate::db::parse_file_size_bytes(file_size.as_deref());
            Some(UnifiedItem {
                id: format!("{}:{}", source_id, i),
                source_id: source_id.to_string(),
                source_name: source_name.to_string(),
                title,
                subtitle: cell(row, subtitle_idx),
                file_size,
                file_size_bytes,
                link: cell(row, link_idx),
                raw: None,
            })
        })
        .collect()
}

/// Separa "Título - https://…" en título y enlace.
fn split_text_line(line: &str) -> (String, Option<String>) {
    let lower = line.to_lowercase();
    let pos = ["magnet:", "https://", "http://", "ftp://"].iter().filter_map(|p| lower.find(p)).min();
    match pos {
        Some(p) => {
            let link: String = line[p..].split_whitespace().next().unwrap_or("").to_string();
            let title = line[..p].trim().trim_end_matches(|c: char| " -–—|:,;\t".contains(c)).trim().to_string();
            if title.is_empty() {
                (link.clone(), Some(link))
            } else {
                (title, Some(link))
            }
        }
        None => (line.trim().to_string(), None),
    }
}

pub fn parse_text_lines(content: &str, source_id: &str, source_name: &str) -> Vec<UnifiedItem> {
    content
        .lines()
        .enumerate()
        .filter_map(|(idx, line)| {
            let t = line.trim();
            if t.is_empty() {
                return None;
            }
            let (title, link) = split_text_line(t);
            Some(UnifiedItem {
                id: format!("{}:{}", source_id, idx),
                source_id: source_id.to_string(),
                source_name: source_name.to_string(),
                title,
                subtitle: None,
                file_size: None,
                file_size_bytes: None,
                link,
                raw: None,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Punto de entrada común (importar, previsualizar y remapear)
// ---------------------------------------------------------------------------

pub enum DetectedFormat {
    Json(Value),
    Jsonl(Value),
    Delimited(u8),
    Text,
}

pub fn detect_format(content: &str, mapping: Option<&MappingConfig>) -> DetectedFormat {
    let trimmed = content.trim_start_matches('\u{feff}');
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if v.is_array() || v.is_object() {
            return DetectedFormat::Json(v);
        }
    }
    if let Some(v) = parse_jsonl(trimmed) {
        return DetectedFormat::Jsonl(v);
    }
    if let Some(d) = delimiter_from_config(mapping).or_else(|| sniff_delimiter(trimmed)) {
        return DetectedFormat::Delimited(d);
    }
    DetectedFormat::Text
}

/// Convierte cualquier contenido (no envelope) en elementos.
pub fn parse_items(content: &str, source_id: &str, source_name: &str, mapping: Option<&MappingConfig>) -> Vec<UnifiedItem> {
    match detect_format(content, mapping) {
        DetectedFormat::Json(v) => {
            let d = v.get("d").filter(|d| d.is_object() || d.is_array()).unwrap_or(&v);
            normalize_json_to_items(d, source_id, source_name, mapping)
        }
        DetectedFormat::Jsonl(v) => normalize_json_to_items(&v, source_id, source_name, mapping),
        DetectedFormat::Delimited(d) => {
            parse_csv_to_items(content.trim_start_matches('\u{feff}'), d, source_id, source_name, mapping)
        }
        DetectedFormat::Text => parse_text_lines(content, source_id, source_name),
    }
}

/// Vista previa de importación: formato, columnas, primeras filas en bruto,
/// mapeo propuesto y cómo quedarían los primeros elementos.
pub fn build_import_preview(name: &str, content: &str, mapping: Option<&MappingConfig>) -> ImportPreview {
    let format = detect_format(content, mapping);
    let mut preview = ImportPreview::default();

    let finish = |mut p: ImportPreview, chosen: MappingConfig, items: Vec<UnifiedItem>| {
        p.total = items.len();
        p.items = items.into_iter().take(PREVIEW_ROWS).collect();
        p.mapping = chosen;
        p
    };

    match format {
        DetectedFormat::Json(ref v) | DetectedFormat::Jsonl(ref v) => {
            preview.format = if matches!(format, DetectedFormat::Jsonl(_)) { "jsonl" } else { "json" }.to_string();

            // Paquete de IndexLy: se importa tal cual, sin mapeo
            if let Some(sources) = parse_v2_envelope(v, name, name) {
                preview.format = "envelope".to_string();
                preview.envelope_sources = sources.len();
                let all: Vec<UnifiedItem> = sources.into_iter().flat_map(|s| s.items).collect();
                return finish(preview, MappingConfig::default(), all);
            }

            let d = v.get("d").filter(|d| d.is_object() || d.is_array()).unwrap_or(v);
            let auto = get_auto_mapping(d);
            preview.columns = auto.available_keys.clone();

            if let Some((cols, rows)) = as_tabular(d) {
                preview.rows = rows
                    .iter()
                    .take(PREVIEW_ROWS)
                    .map(|r| (0..cols.len()).map(|i| r.get(i).and_then(value_to_text).unwrap_or_default()).collect())
                    .collect();
            } else {
                preview.rows = json_records(d)
                    .iter()
                    .take(PREVIEW_ROWS)
                    .map(|(_, rec)| {
                        preview
                            .columns
                            .iter()
                            .map(|c| get_path(rec, c).and_then(value_to_text).unwrap_or_default())
                            .collect()
                    })
                    .collect();
            }

            let chosen = merge_mapping(mapping, &auto.mapping);
            let items = normalize_json_to_items(d, "preview", name, Some(&chosen));
            finish(preview, chosen, items)
        }
        DetectedFormat::Delimited(d) => {
            let has_header = mapping.and_then(|m| m.has_header).unwrap_or(true);
            let body = content.trim_start_matches('\u{feff}');
            let (headers, rows) = read_csv(body, d, has_header);
            preview.format = if d == b'\t' { "tsv" } else { "csv" }.to_string();
            preview.delimiter = Some(delimiter_label(d));
            preview.has_header = has_header;
            preview.columns = headers.clone();
            preview.rows = rows.iter().take(PREVIEW_ROWS).cloned().collect();

            // Mapeo automático por nombre de columna y por contenido
            let lower: Vec<String> = headers.iter().map(|h| h.to_lowercase()).collect();
            let by = |cands: &[&str]| lower.iter().position(|h| cands.contains(&h.as_str())).map(|i| headers[i].clone());
            let first = rows.first();
            let auto = MappingConfig {
                title_key: by(TITLE_KEYS).or_else(|| headers.first().cloned()),
                link_key: by(LINK_KEYS)
                    .or_else(|| first.and_then(|r| r.iter().position(|c| is_link_value(c))).map(|i| headers[i].clone())),
                subtitle_key: by(SUBTITLE_KEYS),
                size_key: by(SIZE_KEYS),
                delimiter: Some(delimiter_label(d)),
                has_header: Some(has_header),
            };
            let mut chosen = merge_mapping(mapping, &auto);
            chosen.delimiter = Some(delimiter_label(d));
            chosen.has_header = Some(has_header);
            let items = parse_csv_to_items(body, d, "preview", name, Some(&chosen));
            finish(preview, chosen, items)
        }
        DetectedFormat::Text => {
            preview.format = "text".to_string();
            preview.columns = vec!["Línea".to_string()];
            preview.rows = content
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .take(PREVIEW_ROWS)
                .map(|l| vec![l.to_string()])
                .collect();
            let items = parse_text_lines(content, "preview", name);
            finish(preview, MappingConfig::default(), items)
        }
    }
}

/// Lo elegido por el usuario manda; lo que no haya elegido se completa con lo detectado.
/// Una cadena vacía significa "ninguno" a propósito.
fn merge_mapping(chosen: Option<&MappingConfig>, auto: &MappingConfig) -> MappingConfig {
    let pick = |c: Option<&Option<String>>, a: &Option<String>| match c {
        Some(Some(v)) if v.trim().is_empty() => None,
        Some(Some(v)) => Some(v.clone()),
        _ => a.clone(),
    };
    MappingConfig {
        title_key: pick(chosen.map(|m| &m.title_key), &auto.title_key),
        link_key: pick(chosen.map(|m| &m.link_key), &auto.link_key),
        subtitle_key: pick(chosen.map(|m| &m.subtitle_key), &auto.subtitle_key),
        size_key: pick(chosen.map(|m| &m.size_key), &auto.size_key),
        delimiter: chosen.and_then(|m| m.delimiter.clone()).or_else(|| auto.delimiter.clone()),
        has_header: chosen.and_then(|m| m.has_header).or(auto.has_header),
    }
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

        assert_eq!(parsed[0].source.name, "onlinefix");
        assert_eq!(parsed[0].items.len(), 2);
        assert_eq!(parsed[0].items[0].title, "Among Us 2026");
        assert_eq!(parsed[0].items[0].file_size.as_deref(), Some("694 MB"));
        assert_eq!(parsed[0].items[0].link.as_deref(), Some("magnet:?xt=urn:btih:123"));
        assert_eq!(parsed[0].source.pkg.as_ref().unwrap().slug, "gamepack-1");

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
            ..Default::default()
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
            ..Default::default()
        };

        let items = normalize_json_to_items(&tabular_json, "src_tab", "Tabular Source", Some(&mapping));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Silksong");
        assert_eq!(items[0].link.as_deref(), Some("magnet:?xt=urn:btih:silk"));
        assert_eq!(items[0].file_size.as_deref(), Some("9 GB"));
        assert_eq!(items[0].file_size_bytes, Some(9 * 1024 * 1024 * 1024));
    }

    #[test]
    fn test_nested_paths_and_numbers() {
        let data = json!({
            "results": [
                { "info": { "title": "Hollow Knight", "year": 2017 }, "links": [{ "url": "https://a.com/hk" }], "bytes": 5368709120u64 },
                { "info": { "title": "Celeste", "year": 2018 }, "links": [{ "url": "https://a.com/ce" }], "bytes": 1048576 }
            ]
        });
        let mapping = MappingConfig {
            title_key: Some("info.title".into()),
            subtitle_key: Some("info.year".into()),
            link_key: Some("links[0].url".into()),
            size_key: Some("bytes".into()),
            ..Default::default()
        };
        let items = normalize_json_to_items(&data, "s", "S", Some(&mapping));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Hollow Knight");
        assert_eq!(items[0].subtitle.as_deref(), Some("2017"));
        assert_eq!(items[0].link.as_deref(), Some("https://a.com/hk"));
        assert_eq!(items[0].file_size.as_deref(), Some("5.0 GB"));
        assert_eq!(items[1].file_size.as_deref(), Some("1.0 MB"));

        // La detección automática encuentra rutas anidadas
        let auto = get_auto_mapping(&data).mapping;
        assert_eq!(auto.title_key.as_deref(), Some("info.title"));
        assert_eq!(auto.link_key.as_deref(), Some("links[0].url"));
    }

    #[test]
    fn test_sniff_delimiters_and_text() {
        assert_eq!(sniff_delimiter("a;b;c\n1;2;3\n4;5;6"), Some(b';'));
        assert_eq!(sniff_delimiter("a\tb\n1\t2"), Some(b'\t'));
        assert_eq!(sniff_delimiter("title,url\n\"Hello, World\",https://x.y"), Some(b','));
        // Una lista de títulos con alguna coma suelta no es un CSV
        assert_eq!(sniff_delimiter("Hello, World\nOtro título\nTercero"), None);

        let items = parse_text_lines("Elden Ring - magnet:?xt=urn:btih:abc\nSolo título", "s", "S");
        assert_eq!(items[0].title, "Elden Ring");
        assert_eq!(items[0].link.as_deref(), Some("magnet:?xt=urn:btih:abc"));
        assert_eq!(items[1].link, None);
    }

    #[test]
    fn test_jsonl_and_headerless_csv() {
        let jsonl = "{\"name\":\"A\",\"url\":\"https://a\"}\n{\"name\":\"B\",\"url\":\"https://b\"}";
        let items = parse_items(jsonl, "s", "S", None);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].link.as_deref(), Some("https://b"));

        let csv = "Doom;https://d\nHades;https://h";
        let m = MappingConfig { has_header: Some(false), ..Default::default() };
        let items = parse_items(csv, "s", "S", Some(&m));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Doom");
        assert_eq!(items[0].link.as_deref(), Some("https://d"));
    }

    #[test]
    fn test_tabular_subtitle_never_panics_on_multibyte() {
        let tab = json!({ "k": ["title", "desc"], "v": [["X", "Steam Rip · versión ñ larga"]] });
        let m = MappingConfig { subtitle_key: Some("desc".into()), ..Default::default() };
        let items = normalize_json_to_items(&tab, "s", "S", Some(&m));
        assert_eq!(items[0].subtitle.as_deref(), Some("Steam Rip · versión ñ larga"));
    }

    #[test]
    fn test_export_envelope_roundtrip() {
        // Mismo formato que genera `export_sources`
        let exported = json!({
            "v": 2,
            "g": false,
            "s": [
                { "n": "stream-1", "a": true, "m": ["title", "link", "subtitle", "size"],
                  "d": [{ "title": "Dune", "subtitle": "1080p", "link": "https://d", "size": "9.8 GB" }] },
                { "n": "pc", "a": false, "p": ["gamepack-1", "gamepack-1"], "m": ["title", "link", "subtitle", "size"],
                  "d": [{ "title": "Doom", "link": "magnet:?xt=urn:btih:x" }] }
            ]
        });
        let parsed = parse_v2_envelope(&exported, "export", "export").unwrap();
        assert_eq!(parsed.len(), 2);
        // Las fuentes sueltas siguen sueltas; las de paquete conservan su carpeta
        assert!(parsed[0].source.pkg.is_none());
        assert_eq!(parsed[1].source.pkg.as_ref().unwrap().slug, "gamepack-1");
        assert!(!parsed[1].source.active);
        let it = &parsed[0].items[0];
        assert_eq!(it.title, "Dune");
        assert_eq!(it.subtitle.as_deref(), Some("1080p"));
        assert_eq!(it.link.as_deref(), Some("https://d"));
        assert_eq!(it.file_size.as_deref(), Some("9.8 GB"));
    }

    #[test]
    fn test_preview() {
        let csv = "nombre;enlace;peso\nDoom;https://d;38 GB\nHades;https://h;4 GB";
        let p = build_import_preview("x.csv", csv, None);
        assert_eq!(p.format, "csv");
        assert_eq!(p.delimiter.as_deref(), Some(";"));
        assert_eq!(p.columns, vec!["nombre", "enlace", "peso"]);
        assert_eq!(p.total, 2);
        assert_eq!(p.mapping.title_key.as_deref(), Some("nombre"));
        assert_eq!(p.mapping.link_key.as_deref(), Some("enlace"));
        assert_eq!(p.mapping.size_key.as_deref(), Some("peso"));
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
