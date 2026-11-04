// src-tauri/src/plugin_commands.rs — Comandos IPC de la API de plugins (dominio `plugin:*`)
use crate::commands::{
    native_close_window, native_fs_read_dir, native_hide_window, native_show_window,
    native_spawn_process, native_toggle_window, AppState,
};
use crate::models::{FsEntry, ProcessRunResult, Source, UnifiedItem};
use tauri::{AppHandle, State};
use uuid::Uuid;

// ============================================================================
// Plugin API v1 IPC Commands (`plugin:*`)
// ============================================================================

#[tauri::command]
pub fn plugin_fs_read(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Error leyendo bytes de '{}': {}", path, e))
}

#[tauri::command]
pub fn plugin_fs_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Error leyendo texto de '{}': {}", path, e))
}

#[tauri::command]
pub fn plugin_fs_write(
    path: String,
    content: Option<String>,
    bytes: Option<Vec<u8>>,
) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Some(b) = bytes {
        std::fs::write(&path, b).map_err(|e| format!("Error escribiendo bytes en '{}': {}", path, e))
    } else if let Some(text) = content {
        std::fs::write(&path, text).map_err(|e| format!("Error escribiendo texto en '{}': {}", path, e))
    } else {
        std::fs::write(&path, []).map_err(|e| format!("Error creando archivo vacío en '{}': {}", path, e))
    }
}

#[tauri::command]
pub fn plugin_fs_mkdir(path: String, recursive: Option<bool>) -> Result<(), String> {
    if recursive.unwrap_or(true) {
        std::fs::create_dir_all(&path).map_err(|e| format!("Error creando directorio '{}': {}", path, e))
    } else {
        std::fs::create_dir(&path).map_err(|e| format!("Error creando directorio '{}': {}", path, e))
    }
}

#[tauri::command]
pub fn plugin_fs_remove(path: String, recursive: Option<bool>) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        if recursive.unwrap_or(false) {
            std::fs::remove_dir_all(p).map_err(|e| format!("Error eliminando directorio '{}': {}", path, e))
        } else {
            std::fs::remove_dir(p).map_err(|e| format!("Error eliminando directorio '{}': {}", path, e))
        }
    } else {
        std::fs::remove_file(p).map_err(|e| format!("Error eliminando archivo '{}': {}", path, e))
    }
}

#[tauri::command]
pub fn plugin_fs_rename(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| format!("Error renombrando '{}' a '{}': {}", from, to, e))
}

#[tauri::command]
pub fn plugin_fs_stat(path: String) -> Result<serde_json::Value, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Error obteniendo metadata de '{}': {}", path, e))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let created = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    Ok(serde_json::json!({
        "size": meta.len(),
        "isFile": meta.is_file(),
        "isDirectory": meta.is_dir(),
        "isSymlink": meta.is_symlink(),
        "modified": modified,
        "created": created,
    }))
}

#[tauri::command]
pub fn plugin_fs_read_dir(path: String, recursive: Option<bool>) -> Result<Vec<FsEntry>, String> {
    native_fs_read_dir(path, recursive)
}

#[tauri::command]
pub async fn plugin_process_exec(
    cmd: String,
    args: Option<Vec<String>>,
    cwd: Option<String>,
) -> Result<ProcessRunResult, String> {
    native_spawn_process(cmd, args.unwrap_or_default(), cwd).await
}

#[tauri::command]
pub fn plugin_process_env() -> Result<std::collections::HashMap<String, String>, String> {
    Ok(std::env::vars().collect())
}

#[tauri::command]
pub fn plugin_db_query(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<serde_json::Value>, String> {
    state
        .db
        .query_raw_json_readonly(&query)
        .map_err(|e| format!("Error consultando SQLite: {}", e))
}

#[tauri::command]
pub fn plugin_db_exec(
    state: State<'_, AppState>,
    query: String,
) -> Result<serde_json::Value, String> {
    let rows = state
        .db
        .execute_raw(&query)
        .map_err(|e| format!("Error ejecutando SQLite: {}", e))?;
    Ok(serde_json::json!({ "rowsAffected": rows }))
}

#[tauri::command]
pub fn plugin_keychain_get(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state.db.keychain_get(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_keychain_set(
    state: State<'_, AppState>,
    key: String,
    val: String,
) -> Result<(), String> {
    state.db.keychain_set(&key, &val).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_keychain_delete(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    state.db.keychain_delete(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_storage_get(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    state.db.plugin_storage_get(&plugin_id, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_storage_set(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
    val: String,
) -> Result<(), String> {
    state.db.plugin_storage_set(&plugin_id, &key, &val).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_storage_delete(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
) -> Result<(), String> {
    state.db.plugin_storage_delete(&plugin_id, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_storage_list_keys(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<Vec<String>, String> {
    state.db.plugin_storage_list_keys(&plugin_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_window_show(app: AppHandle, label: String) -> Result<(), String> {
    native_show_window(app, label)
}

#[tauri::command]
pub fn plugin_window_hide(app: AppHandle, label: String) -> Result<(), String> {
    native_hide_window(app, label)
}

#[tauri::command]
pub fn plugin_window_close(app: AppHandle, label: String) -> Result<(), String> {
    native_close_window(app, label)
}

#[tauri::command]
pub fn plugin_window_toggle(app: AppHandle, label: String) -> Result<bool, String> {
    native_toggle_window(app, label)
}

/// Respuesta normalizada de una petición HTTP nativa.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
}

/// Realiza una petición HTTP desde Rust (sin CORS ni restricciones del webview).
///
/// Pensado para hablar con servicios locales (qBittorrent Web API, Transmission,
/// Jellyfin…). Los códigos 4xx/5xx se devuelven como respuesta normal, no como
/// error, para que el plugin pueda inspeccionar `status` y el cuerpo.
///
/// Nota: se descartan deliberadamente `Origin`, `Referer`, `Host` y
/// `Content-Length`. qBittorrent rechaza los POST que llevan `Origin`/`Referer`
/// por su protección CSRF, y el resto los calcula `ureq`.
#[tauri::command]
pub async fn plugin_http_request(
    method: String,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<HttpResponsePayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(15_000));
        let agent = ureq::AgentBuilder::new()
            .timeout(timeout)
            .redirects(5)
            .build();

        let verb = method.trim().to_uppercase();
        let mut req = match verb.as_str() {
            "GET" => agent.get(&url),
            "POST" => agent.post(&url),
            "PUT" => agent.put(&url),
            "PATCH" => agent.request("PATCH", &url),
            "DELETE" => agent.delete(&url),
            "HEAD" => agent.head(&url),
            other => return Err(format!("Método HTTP no soportado: {}", other)),
        };

        if let Some(hs) = headers {
            for (key, value) in hs {
                let lower = key.to_ascii_lowercase();
                if matches!(lower.as_str(), "origin" | "referer" | "host" | "content-length") {
                    continue;
                }
                req = req.set(&key, &value);
            }
        }

        let raw = match body {
            Some(b) => req.send_string(&b),
            None => req.call(),
        };

        // Un status 4xx/5xx es una respuesta válida para el plugin.
        let resp = match raw {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(format!("Error de red: {}", e)),
        };

        let status = resp.status();
        let mut out_headers = std::collections::HashMap::new();
        for name in resp.headers_names() {
            if let Some(value) = resp.header(&name) {
                out_headers.insert(name, value.to_string());
            }
        }
        let body = resp
            .into_string()
            .map_err(|e| format!("Error leyendo la respuesta: {}", e))?;

        Ok(HttpResponsePayload {
            status,
            headers: out_headers,
            body,
        })
    })
    .await
    .map_err(|e| format!("Error ejecutando la petición HTTP: {}", e))?
}

/// Crea o actualiza una fuente gestionada por un plugin y reemplaza sus items
/// en una sola transacción.
///
/// Resuelve la fuente por `source_id`, luego por nombre exacto y, si no existe,
/// crea una nueva con UUID. Los items se normalizan para que siempre apunten a
/// la fuente correcta, y se respeta el estado `active` previo para no reactivar
/// una fuente que el usuario desactivó a mano.
#[tauri::command]
pub fn plugin_source_sync_items(
    state: State<'_, AppState>,
    source_id: Option<String>,
    name: String,
    items: Vec<UnifiedItem>,
    flags: Option<std::collections::HashMap<String, bool>>,
) -> Result<Source, String> {
    let clean_name = name.trim().to_string();
    if clean_name.is_empty() {
        return Err("El nombre de la fuente no puede estar vacío".to_string());
    }

    let existing = state
        .db
        .get_sources()
        .map_err(|e| format!("Error obteniendo fuentes: {}", e))?;

    let requested = source_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .filter(|id| existing.iter().any(|s| &s.id == id));

    let id = requested
        .or_else(|| existing.iter().find(|s| s.name == clean_name).map(|s| s.id.clone()))
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let previous = existing.iter().find(|s| s.id == id);

    let mut normalized = Vec::with_capacity(items.len());
    for (index, mut item) in items.into_iter().enumerate() {
        if item.id.trim().is_empty() {
            item.id = format!("{}-{}", id, index);
        }
        item.source_id = id.clone();
        item.source_name = clean_name.clone();
        normalized.push(item);
    }

    let source = Source {
        id: id.clone(),
        name: clean_name,
        active: previous.map(|s| s.active).unwrap_or(true),
        count: normalized.len(),
        mapping: None,
        pkg: None,
        flags: flags.or_else(|| previous.and_then(|s| s.flags.clone())),
    };

    state
        .db
        .insert_source_with_items(&source, None, &normalized)
        .map_err(|e| format!("Error sincronizando la fuente: {}", e))?;

    Ok(source)
}

#[tauri::command]
pub fn plugin_storage_read_text(
    state: State<'_, AppState>,
    plugin_id: String,
    filename: String,
) -> Result<String, String> {
    state
        .db
        .plugin_storage_get(&plugin_id, &filename)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Archivo no encontrado: '{}'", filename))
}

#[tauri::command]
pub fn plugin_storage_write_text(
    state: State<'_, AppState>,
    plugin_id: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    state
        .db
        .plugin_storage_set(&plugin_id, &filename, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_storage_remove(
    state: State<'_, AppState>,
    plugin_id: String,
    filename: String,
) -> Result<(), String> {
    state
        .db
        .plugin_storage_delete(&plugin_id, &filename)
        .map_err(|e| e.to_string())
}
