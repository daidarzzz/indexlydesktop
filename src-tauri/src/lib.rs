// src-tauri/src/lib.rs — Punto de entrada de la aplicación Tauri v2
pub mod commands;
pub mod db;
pub mod models;
pub mod normalizer;
pub mod plugin_commands;
pub mod plugins;
pub mod adblock;

use commands::AppState;
use db::Database;
use plugins::PluginManager;
use std::fs;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let sc_str = shortcut.to_string();
                        let _ = app.emit("global-shortcut:pressed", &sc_str);

                        // Soporte integrado para alt+space / spotlight (solo si el plugin está activado)
                        let sc_lower = sc_str.to_lowercase();
                        if sc_lower.contains("space") {
                            let is_spotlight_enabled = app
                                .try_state::<AppState>()
                                .map(|s| s.plugins.is_plugin_enabled("spotlight"))
                                .unwrap_or(false);

                            if is_spotlight_enabled {
                                if let Some(spotlight) = app.get_webview_window("spotlight") {
                                    if let Ok(is_visible) = spotlight.is_visible() {
                                        if is_visible {
                                            let _ = spotlight.hide();
                                        } else {
                                            let _ = spotlight.show();
                                            let _ = spotlight.unminimize();
                                            let _ = spotlight.set_focus();
                                            let _ = spotlight.emit("spotlight:open", ());
                                        }
                                    } else {
                                        let _ = spotlight.show();
                                        let _ = spotlight.set_focus();
                                        let _ = spotlight.emit("spotlight:open", ());
                                    }
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Ok(shortcut) = "alt+space".parse::<Shortcut>() {
                if let Err(err) = app.global_shortcut().register(shortcut) {
                    eprintln!("[Spotlight] No se pudo registrar Alt+Espacio (¿lo usa otra app?): {err}");
                }
            }

            if let Some(spotlight) = app.get_webview_window("spotlight") {
                let win_clone = spotlight.clone();
                spotlight.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }
            // Resolver directorio de datos de usuario de IndexLy
            let icon = tauri::include_image!("icons/128x128.png");
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_icon(icon.clone());
            }
            if let Some(spotlight) = app.get_webview_window("spotlight") {
                let _ = spotlight.set_icon(icon);
            }
            let app_data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap().join(".indexly_data"));

            let _ = fs::create_dir_all(&app_data);

            let db_path = app_data.join("indexly.db");
            let db = Database::new(db_path).expect("No se pudo inicializar la base de datos SQLite FTS5");

            let plugins_dir = app_data.join("plugins");
            let plugins = PluginManager::new(plugins_dir);
            let adblock = Arc::new(crate::adblock::AdblockManager::new());

            app.manage(AppState {
                db: Arc::new(db),
                plugins: Arc::new(plugins),
                adblock,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_file,
            commands::import_torrent,
            commands::preview_import,
            commands::export_sources,
            commands::get_sources,
            commands::toggle_source,
            commands::delete_source,
            commands::toggle_package,
            commands::delete_package,
            commands::import_hub_package,
            commands::open_external_url,
            commands::detect_mapping,
            commands::search_items,
            commands::get_plugins,
            commands::toggle_plugin,
            commands::get_source_mapping_info,
            commands::update_source_mapping,
            commands::get_source_items,
            commands::install_hub_plugin,
            commands::hide_window,
            commands::native_create_window,
            commands::native_show_window,
            commands::native_hide_window,
            commands::native_close_window,
            commands::native_toggle_window,
            commands::native_spawn_process,
            commands::native_fs_read_dir,
            commands::native_fs_read_file,
            commands::native_fs_write_file,
            commands::native_fs_exists,
            commands::native_sql_execute,
            commands::native_sql_query,
            commands::native_register_shortcut,
            commands::native_unregister_shortcut,
            commands::adblock_check_url,
            commands::adblock_get_info,
            commands::extract_direct_stream,
            commands::plugin_fs_read,
            commands::plugin_fs_read_text,
            commands::plugin_fs_write,
            commands::plugin_fs_mkdir,
            commands::plugin_fs_remove,
            commands::plugin_fs_rename,
            commands::plugin_fs_stat,
            commands::plugin_fs_read_dir,
            commands::plugin_process_exec,
            commands::plugin_process_env,
            commands::plugin_db_query,
            commands::plugin_db_exec,
            commands::plugin_keychain_get,
            commands::plugin_keychain_set,
            commands::plugin_keychain_delete,
            commands::plugin_storage_get,
            commands::plugin_storage_set,
            commands::plugin_storage_delete,
            commands::plugin_storage_list_keys,
            commands::plugin_storage_read_text,
            commands::plugin_storage_write_text,
            commands::plugin_storage_remove,
            commands::plugin_window_show,
            commands::plugin_window_hide,
            commands::plugin_window_close,
            commands::plugin_window_toggle,
            commands::plugin_http_request,
            commands::plugin_source_sync_items,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IndexLy Desktop");
}

