// src-tauri/src/db.rs — Motor de base de datos SQLite con FTS5 embebido
use crate::models::{MappingConfig, SearchResult, Source, UnifiedItem};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

/// Parsea una cadena de tamaño legible (ej. "70 GB", "500 MB", "20 KB", "1024") a bytes numéricos.
pub fn parse_file_size_bytes(size_str: Option<&str>) -> Option<i64> {
    let s = size_str?.trim().to_lowercase();
    if s.is_empty() {
        return None;
    }
    // Si ya es un entero puro
    if let Ok(b) = s.parse::<i64>() {
        return Some(b);
    }

    let (num_part, multiplier) = if s.ends_with("tib") || s.ends_with("tb") {
        (s.trim_end_matches("tib").trim_end_matches("tb").trim(), 1024.0 * 1024.0 * 1024.0 * 1024.0)
    } else if s.ends_with("gib") || s.ends_with("gb") {
        (s.trim_end_matches("gib").trim_end_matches("gb").trim(), 1024.0 * 1024.0 * 1024.0)
    } else if s.ends_with("mib") || s.ends_with("mb") {
        (s.trim_end_matches("mib").trim_end_matches("mb").trim(), 1024.0 * 1024.0)
    } else if s.ends_with("kib") || s.ends_with("kb") {
        (s.trim_end_matches("kib").trim_end_matches("kb").trim(), 1024.0)
    } else if s.ends_with('b') {
        (s.trim_end_matches('b').trim(), 1.0)
    } else {
        (s.as_str(), 1.0)
    };

    num_part.parse::<f64>().ok().map(|n| (n * multiplier) as i64)
}

/// Sanitiza una consulta FTS5 preservando frases exactas entrecomilladas `"..."` y limpiando operadores no balanceados.
pub fn sanitize_fts5_query(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut tokens = Vec::new();
    let chars: Vec<char> = trimmed.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }

        // Si comienza una comilla, capturar la frase exacta
        if chars[i] == '"' {
            i += 1;
            let mut phrase = String::new();
            while i < chars.len() && chars[i] != '"' {
                phrase.push(chars[i]);
                i += 1;
            }
            if i < chars.len() && chars[i] == '"' {
                i += 1; // saltar comilla de cierre
            }
            let clean = phrase.trim();
            if !clean.is_empty() {
                // Escapar comillas dobles internas en FTS5
                tokens.push(format!("\"{}\"", clean.replace('"', "\"\"")));
            }
        } else {
            // Palabra normal
            let mut word = String::new();
            while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '"' {
                word.push(chars[i]);
                i += 1;
            }
            // Eliminar caracteres de sintaxis FTS5 que causan error
            let clean: String = word
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if !clean.is_empty() {
                tokens.push(format!("{}*", clean));
            }
        }
    }

    tokens.join(" ")
}

/// Versión actual del esquema. Cada incremento debe añadir una migración
/// transaccional idempotente en `init_schema`.
pub const CURRENT_SCHEMA_VERSION: i64 = 3;

/// Comprueba si una columna existe usando `PRAGMA table_info`.
fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();

        // Optimizaciones de rendimiento SQLite (no estructurales, no bloqueantes)
        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000; -- 64MB de cache
            PRAGMA temp_store = MEMORY;
        ")?;

        let mut version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

        if version >= CURRENT_SCHEMA_VERSION {
            // `PRAGMA optimize` es barato y solo actúa cuando SQLite lo considera útil.
            let _ = conn.execute_batch("PRAGMA optimize;");
            return Ok(());
        }

        // ------------------------------------------------------------------
        // v1: tablas base. Idempotente para bases de datos preexistentes.
        // ------------------------------------------------------------------
        if version < 1 {
            let tx = conn.transaction()?;
            tx.execute_batch("
                CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    mapping_json TEXT,
                    pkg_json TEXT,
                    flags_json TEXT,
                    raw_content TEXT
                );

                CREATE TABLE IF NOT EXISTS items (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    source_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    subtitle TEXT,
                    file_size TEXT,
                    file_size_bytes INTEGER,
                    link TEXT,
                    raw_json TEXT
                );

                CREATE TABLE IF NOT EXISTS _keychain (
                    key TEXT PRIMARY KEY,
                    val TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS plugin_storage (
                    plugin_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    val TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (plugin_id, key)
                );
                CREATE INDEX IF NOT EXISTS idx_plugin_storage_plugin ON plugin_storage(plugin_id);
            ")?;
            tx.pragma_update(None, "user_version", 1i64)?;
            tx.commit()?;
            version = 1;
        }

        // ------------------------------------------------------------------
        // v2: columnas incrementales + backfill de file_size_bytes.
        // ------------------------------------------------------------------
        if version < 2 {
            let tx = conn.transaction()?;

            if !column_exists(&tx, "sources", "flags_json")? {
                tx.execute("ALTER TABLE sources ADD COLUMN flags_json TEXT", [])?;
            }
            if !column_exists(&tx, "items", "file_size_bytes")? {
                tx.execute("ALTER TABLE items ADD COLUMN file_size_bytes INTEGER", [])?;
            }

            let rows_to_update: Vec<(String, Option<String>)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, file_size FROM items WHERE file_size_bytes IS NULL AND file_size IS NOT NULL",
                )?;
                let mapped = stmt.query_map([], |row| {
                    let id: String = row.get(0)?;
                    let file_size: Option<String> = row.get(1)?;
                    Ok((id, file_size))
                })?;
                mapped.filter_map(|r| r.ok()).collect()
            };

            {
                let mut update = tx.prepare("UPDATE items SET file_size_bytes = ?1 WHERE id = ?2")?;
                for (id, size) in rows_to_update {
                    if let Some(bytes) = parse_file_size_bytes(size.as_deref()) {
                        update.execute(params![bytes, id])?;
                    }
                }
            }

            tx.pragma_update(None, "user_version", 2i64)?;
            tx.commit()?;
            version = 2;
        }

        // ------------------------------------------------------------------
        // v3: índices, FTS5, triggers y limpieza única de imports corruptos.
        // El rebuild de FTS ocurre una sola vez por migración, no en cada arranque.
        // ------------------------------------------------------------------
        if version < 3 {
            let tx = conn.transaction()?;

            // Limpieza de fuentes corruptas o imports binarios no válidos de versiones previas
            tx.execute(
                "DELETE FROM items WHERE source_id IN (SELECT id FROM sources WHERE name LIKE '%.torrent' OR name LIKE '%FOjsK%' OR name LIKE '%url-list%' OR name LIKE '%announce%')",
                [],
            )?;
            tx.execute(
                "DELETE FROM sources WHERE name LIKE '%.torrent' OR name LIKE '%FOjsK%' OR name LIKE '%url-list%' OR name LIKE '%announce%'",
                [],
            )?;

            tx.execute_batch("
                CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);
                CREATE INDEX IF NOT EXISTS idx_items_file_size ON items(file_size_bytes);

                CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
                    title,
                    subtitle,
                    content='items',
                    content_rowid='rowid'
                );

                CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
                    INSERT INTO items_fts(rowid, title, subtitle) VALUES (new.rowid, new.title, new.subtitle);
                END;

                CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
                    INSERT INTO items_fts(items_fts, rowid, title, subtitle) VALUES('delete', old.rowid, old.title, old.subtitle);
                END;

                CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
                    INSERT INTO items_fts(items_fts, rowid, title, subtitle) VALUES('delete', old.rowid, old.title, old.subtitle);
                    INSERT INTO items_fts(rowid, title, subtitle) VALUES (new.rowid, new.title, new.subtitle);
                END;
            ")?;

            tx.execute("INSERT INTO items_fts(items_fts) VALUES('rebuild')", [])?;

            tx.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
            tx.commit()?;
        }

        // Optimización ligera; nunca VACUUM ni rebuild en el arranque normal.
        let _ = conn.execute_batch("PRAGMA optimize;");
        Ok(())
    }

    /// Reconstruye el índice FTS5 de forma explícita (reparación manual).
    pub fn rebuild_fts(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO items_fts(items_fts) VALUES('rebuild')", [])?;
        Ok(())
    }

    /// Compacta la base de datos. Operación potencialmente costosa y explícita.
    pub fn vacuum(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("VACUUM", [])?;
        Ok(())
    }

    /// Devuelve la versión de esquema actualmente aplicada.
    pub fn schema_version(&self) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
    }

    pub fn insert_source_with_items(
        &self,
        source: &Source,
        raw_content: Option<&str>,
        items: &[UnifiedItem],
    ) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        let mapping_str = source.mapping.as_ref().and_then(|m| serde_json::to_string(m).ok());
        let pkg_str = source.pkg.as_ref().and_then(|p| serde_json::to_string(p).ok());
        let flags_str = source.flags.as_ref().and_then(|f| serde_json::to_string(f).ok());

        tx.execute(
            "INSERT OR REPLACE INTO sources (id, name, active, mapping_json, pkg_json, flags_json, raw_content) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                source.id,
                source.name,
                if source.active { 1 } else { 0 },
                mapping_str,
                pkg_str,
                flags_str,
                raw_content,
            ],
        )?;

        // Borrar items antiguos de esta fuente si existían
        tx.execute("DELETE FROM items WHERE source_id = ?1", params![source.id])?;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO items (id, source_id, source_name, title, subtitle, file_size, file_size_bytes, link, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;

            for it in items {
                let bytes = it.file_size_bytes.or_else(|| parse_file_size_bytes(it.file_size.as_deref()));
                stmt.execute(params![
                    it.id,
                    it.source_id,
                    it.source_name,
                    it.title,
                    it.subtitle,
                    it.file_size,
                    bytes,
                    it.link,
                    it.raw,
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn insert_sources_batch(
        &self,
        batch: &[(Source, Option<String>, Vec<UnifiedItem>)],
    ) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        for (source, raw_content, items) in batch {
            let mapping_str = source.mapping.as_ref().and_then(|m| serde_json::to_string(m).ok());
            let pkg_str = source.pkg.as_ref().and_then(|p| serde_json::to_string(p).ok());
            let flags_str = source.flags.as_ref().and_then(|f| serde_json::to_string(f).ok());

            // FIX BUG 5: Incluir flags_json en batch SQL
            tx.execute(
                "INSERT OR REPLACE INTO sources (id, name, active, mapping_json, pkg_json, flags_json, raw_content) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    source.id,
                    source.name,
                    if source.active { 1 } else { 0 },
                    mapping_str,
                    pkg_str,
                    flags_str,
                    raw_content.as_deref(),
                ],
            )?;

            tx.execute("DELETE FROM items WHERE source_id = ?1", params![source.id])?;

            {
                let mut stmt = tx.prepare(
                    "INSERT INTO items (id, source_id, source_name, title, subtitle, file_size, file_size_bytes, link, raw_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )?;

                for it in items {
                    let bytes = it.file_size_bytes.or_else(|| parse_file_size_bytes(it.file_size.as_deref()));
                    stmt.execute(params![
                        it.id,
                        it.source_id,
                        it.source_name,
                        it.title,
                        it.subtitle,
                        it.file_size,
                        bytes,
                        it.link,
                        it.raw,
                    ])?;
                }
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn toggle_package(&self, slug: &str, active: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sources SET active = ?1 WHERE json_extract(pkg_json, '$.slug') = ?2",
            params![if active { 1 } else { 0 }, slug],
        )?;
        Ok(())
    }

    pub fn delete_package(&self, slug: &str) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM items WHERE source_id IN (SELECT id FROM sources WHERE json_extract(pkg_json, '$.slug') = ?1)",
            params![slug],
        )?;
        tx.execute(
            "DELETE FROM sources WHERE json_extract(pkg_json, '$.slug') = ?1",
            params![slug],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_sources(&self) -> rusqlite::Result<Vec<Source>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("
            SELECT s.id, s.name, s.active, s.mapping_json, s.pkg_json, s.flags_json, COUNT(i.id) as item_count
            FROM sources s
            LEFT JOIN items i ON s.id = i.source_id
            GROUP BY s.id
            ORDER BY s.name COLLATE NOCASE ASC
        ")?;

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let active: i32 = row.get(2)?;
            let mapping_json: Option<String> = row.get(3)?;
            let pkg_json: Option<String> = row.get(4)?;
            let flags_json: Option<String> = row.get(5)?;
            let count: usize = row.get(6)?;

            let mapping = mapping_json.and_then(|s| serde_json::from_str(&s).ok());
            let pkg = pkg_json.and_then(|s| serde_json::from_str(&s).ok());
            let flags = flags_json.and_then(|s| serde_json::from_str(&s).ok());

            Ok(Source {
                id,
                name,
                active: active != 0,
                count,
                mapping,
                pkg,
                flags,
            })
        })?;

        let mut res = Vec::new();
        for r in rows {
            res.push(r?);
        }
        Ok(res)
    }

    pub fn get_source_with_raw(&self, id: &str) -> rusqlite::Result<Option<(Source, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("
            SELECT s.id, s.name, s.active, s.mapping_json, s.pkg_json, s.flags_json, s.raw_content, COUNT(i.id) as item_count
            FROM sources s
            LEFT JOIN items i ON s.id = i.source_id
            WHERE s.id = ?1
            GROUP BY s.id
        ")?;

        let mut rows = stmt.query_map(params![id], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let active: i32 = row.get(2)?;
            let mapping_json: Option<String> = row.get(3)?;
            let pkg_json: Option<String> = row.get(4)?;
            let flags_json: Option<String> = row.get(5)?;
            let raw_content: Option<String> = row.get(6)?;
            let count: usize = row.get(7)?;

            let mapping = mapping_json.and_then(|s| serde_json::from_str(&s).ok());
            let pkg = pkg_json.and_then(|s| serde_json::from_str(&s).ok());
            let flags = flags_json.and_then(|s| serde_json::from_str(&s).ok());

            Ok((
                Source {
                    id,
                    name,
                    active: active != 0,
                    count,
                    mapping,
                    pkg,
                    flags,
                },
                raw_content,
            ))
        })?;

        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn update_source_mapping_and_items(
        &self,
        id: &str,
        new_name: &str,
        mapping: Option<&MappingConfig>,
        flags: Option<&std::collections::HashMap<String, bool>>,
        items: &[UnifiedItem],
    ) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        let mapping_str = mapping.and_then(|m| serde_json::to_string(m).ok());
        let flags_str = flags.and_then(|f| serde_json::to_string(f).ok());

        tx.execute(
            "UPDATE sources SET name = ?1, mapping_json = ?2, flags_json = ?3 WHERE id = ?4",
            params![new_name, mapping_str, flags_str, id],
        )?;

        tx.execute("DELETE FROM items WHERE source_id = ?1", params![id])?;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO items (id, source_id, source_name, title, subtitle, file_size, file_size_bytes, link, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;

            for it in items {
                let bytes = it.file_size_bytes.or_else(|| parse_file_size_bytes(it.file_size.as_deref()));
                stmt.execute(params![
                    it.id,
                    it.source_id,
                    it.source_name,
                    it.title,
                    it.subtitle,
                    it.file_size,
                    bytes,
                    it.link,
                    it.raw,
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn toggle_source(&self, id: &str, active: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sources SET active = ?1 WHERE id = ?2",
            params![if active { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn delete_source(&self, id: &str) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM items WHERE source_id = ?1", params![id])?;
        tx.execute("DELETE FROM sources WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_source_raw_content(&self, id: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT raw_content FROM sources WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let content: Option<String> = row.get(0)?;
            Ok(content)
        } else {
            Ok(None)
        }
    }

    pub fn update_source_raw_content(&self, id: &str, raw_content: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sources SET raw_content = ?1 WHERE id = ?2",
            params![raw_content, id],
        )?;
        Ok(())
    }

    pub fn get_items_by_source(&self, source_id: &str) -> rusqlite::Result<Vec<UnifiedItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, source_id, source_name, title, subtitle, file_size, link, raw_json, file_size_bytes
             FROM items WHERE source_id = ?1",
        )?;
        let rows = stmt.query_map(params![source_id], |row| {
            Ok(UnifiedItem {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                title: row.get(3)?,
                subtitle: row.get(4)?,
                file_size: row.get(5)?,
                link: row.get(6)?,
                raw: row.get(7)?,
                file_size_bytes: row.get(8)?,
            })
        })?;
        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }
        Ok(items)
    }

    pub fn get_sample_item(&self, source_id: &str) -> rusqlite::Result<Option<UnifiedItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, source_id, source_name, title, subtitle, file_size, link, raw_json, file_size_bytes
             FROM items WHERE source_id = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![source_id], |row| {
            Ok(UnifiedItem {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                title: row.get(3)?,
                subtitle: row.get(4)?,
                file_size: row.get(5)?,
                link: row.get(6)?,
                raw: row.get(7)?,
                file_size_bytes: row.get(8)?,
            })
        })?;
        if let Some(first) = rows.next() {
            Ok(Some(first?))
        } else {
            Ok(None)
        }
    }

    pub fn search(
        &self,
        query: &str,
        filter_link: Option<&str>,
        sort_by: &str,
        limit: u32,
        offset: u32,
    ) -> rusqlite::Result<SearchResult> {
        let start = Instant::now();
        let conn = self.conn.lock().unwrap();

        // 1. Obtener conteos globales
        let mut count_stmt = conn.prepare("
            SELECT 
                (SELECT COUNT(*) FROM sources WHERE active = 1),
                (SELECT COUNT(*) FROM items WHERE source_id IN (SELECT id FROM sources WHERE active = 1))
        ")?;
        let (active_sources_count, total_items_count): (usize, usize) = count_stmt.query_row([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;

        if active_sources_count == 0 {
            return Ok(SearchResult {
                items: Vec::new(),
                total: 0,
                active_sources_count: 0,
                total_items_count: 0,
                took_ms: start.elapsed().as_secs_f64() * 1000.0,
            });
        }

        let q_clean = query.trim();
        let mut filter_clause = String::new();
        if let Some(fl) = filter_link {
            if fl == "link" {
                filter_clause.push_str(" AND (i.link IS NOT NULL AND i.link != '')");
            } else if fl == "nolink" {
                filter_clause.push_str(" AND (i.link IS NULL OR i.link = '')");
            }
        }

        // FIX BUG 2: Ordenación numérica por file_size_bytes en lugar de orden alfabético
        let order_clause = match sort_by {
            "title-asc" => "ORDER BY i.title COLLATE NOCASE ASC",
            "title-desc" => "ORDER BY i.title COLLATE NOCASE DESC",
            "size-desc" => "ORDER BY COALESCE(i.file_size_bytes, 0) DESC, i.rowid DESC",
            "size-asc" => "ORDER BY COALESCE(i.file_size_bytes, 0) ASC, i.rowid ASC",
            _ => if !q_clean.is_empty() { "ORDER BY rank" } else { "ORDER BY i.rowid DESC" },
        };

        let (items, total) = if q_clean.is_empty() {
            // Sin término de búsqueda: paginación directa
            let count_sql = format!(
                "SELECT COUNT(*) FROM items i WHERE i.source_id IN (SELECT id FROM sources WHERE active = 1) {}",
                filter_clause
            );
            let mut total_stmt = conn.prepare(&count_sql)?;
            let total: usize = total_stmt.query_row([], |r| r.get(0))?;

            let data_sql = format!(
                "SELECT i.id, i.source_id, i.source_name, i.title, i.subtitle, i.file_size, i.link, i.raw_json, i.file_size_bytes
                 FROM items i
                 WHERE i.source_id IN (SELECT id FROM sources WHERE active = 1) {}
                 {} LIMIT ?1 OFFSET ?2",
                filter_clause, order_clause
            );

            let mut stmt = conn.prepare(&data_sql)?;
            let rows = stmt.query_map(params![limit, offset], |row| {
                Ok(UnifiedItem {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    source_name: row.get(2)?,
                    title: row.get(3)?,
                    subtitle: row.get(4)?,
                    file_size: row.get(5)?,
                    link: row.get(6)?,
                    raw: row.get(7)?,
                    file_size_bytes: row.get(8)?,
                })
            })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            (list, total)
        } else {
            // FIX BUG 3: Búsqueda FTS5 con sanitización que preserva frases exactas
            let fts_query = sanitize_fts5_query(q_clean);
            if fts_query.is_empty() {
                return Ok(SearchResult {
                    items: Vec::new(),
                    total: 0,
                    active_sources_count,
                    total_items_count,
                    took_ms: start.elapsed().as_secs_f64() * 1000.0,
                });
            }

            let count_sql = format!(
                "SELECT COUNT(*)
                 FROM items_fts f
                 JOIN items i ON f.rowid = i.rowid
                 WHERE items_fts MATCH ?1 AND i.source_id IN (SELECT id FROM sources WHERE active = 1) {}",
                filter_clause
            );

            let total: usize = conn
                .prepare(&count_sql)
                .and_then(|mut stmt| stmt.query_row(params![&fts_query], |r| r.get(0)))
                .unwrap_or(0);

            let data_sql = format!(
                "SELECT i.id, i.source_id, i.source_name, i.title, i.subtitle, i.file_size, i.link, i.raw_json, i.file_size_bytes
                 FROM items_fts f
                 JOIN items i ON f.rowid = i.rowid
                 WHERE items_fts MATCH ?1 AND i.source_id IN (SELECT id FROM sources WHERE active = 1) {}
                 {} LIMIT ?2 OFFSET ?3",
                filter_clause, order_clause
            );

            let list = match conn.prepare(&data_sql) {
                Ok(mut stmt) => {
                    let rows = stmt.query_map(params![&fts_query, limit, offset], |row| {
                        Ok(UnifiedItem {
                            id: row.get(0)?,
                            source_id: row.get(1)?,
                            source_name: row.get(2)?,
                            title: row.get(3)?,
                            subtitle: row.get(4)?,
                            file_size: row.get(5)?,
                            link: row.get(6)?,
                            raw: row.get(7)?,
                            file_size_bytes: row.get(8)?,
                        })
                    })?;
                    let mut items = Vec::new();
                    for r in rows {
                        items.push(r?);
                    }
                    items
                }
                Err(_) => Vec::new(),
            };

            (list, total)
        };

        Ok(SearchResult {
            items,
            total,
            active_sources_count,
            total_items_count,
            took_ms: start.elapsed().as_secs_f64() * 1000.0,
        })
    }

    pub fn execute_raw(&self, sql: &str) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(sql, [])
    }

    pub fn query_raw_json(&self, sql: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(sql)?;
        let col_names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();

        let mut rows = stmt.query([])?;
        let mut results = Vec::new();

        while let Some(row) = rows.next()? {
            let mut map = serde_json::Map::new();
            for (idx, name) in col_names.iter().enumerate() {
                let val: rusqlite::types::Value = row.get(idx)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(i) => serde_json::Value::Number(i.into()),
                    rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null),
                    rusqlite::types::Value::Text(t) => serde_json::Value::String(t),
                    rusqlite::types::Value::Blob(b) => serde_json::Value::String(format!("<blob len={}>", b.len())),
                };
                map.insert(name.clone(), json_val);
            }
            results.push(serde_json::Value::Object(map));
        }

        Ok(results)
    }

    /// Ejecuta una consulta SQL en modo ESTRICTO de solo lectura (`PRAGMA query_only = ON;`).
    /// Si la consulta intenta modificar datos (INSERT, UPDATE, DROP, DELETE, etc.), SQLite la rechazará.
    pub fn query_raw_json_readonly(&self, sql: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("PRAGMA query_only = ON;")?;

        let res = (|| {
            let mut stmt = conn.prepare(sql)?;
            let col_names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();

            let mut rows = stmt.query([])?;
            let mut results = Vec::new();

            while let Some(row) = rows.next()? {
                let mut map = serde_json::Map::new();
                for (idx, name) in col_names.iter().enumerate() {
                    let val: rusqlite::types::Value = row.get(idx)?;
                    let json_val = match val {
                        rusqlite::types::Value::Null => serde_json::Value::Null,
                        rusqlite::types::Value::Integer(i) => serde_json::Value::Number(i.into()),
                        rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
                            .map(serde_json::Value::Number)
                            .unwrap_or(serde_json::Value::Null),
                        rusqlite::types::Value::Text(t) => serde_json::Value::String(t),
                        rusqlite::types::Value::Blob(b) => serde_json::Value::String(format!("<blob len={}>", b.len())),
                    };
                    map.insert(name.clone(), json_val);
                }
                results.push(serde_json::Value::Object(map));
            }
            Ok(results)
        })();

        let _ = conn.execute_batch("PRAGMA query_only = OFF;");
        res
    }

    // ========================================================================
    // Keychain API
    // ========================================================================

    pub fn keychain_get(&self, key: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT val FROM _keychain WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn keychain_set(&self, key: &str, val: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO _keychain (key, val) VALUES (?1, ?2)",
            params![key, val],
        )?;
        Ok(())
    }

    pub fn keychain_delete(&self, key: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM _keychain WHERE key = ?1", params![key])?;
        Ok(())
    }

    // ========================================================================
    // Plugin Storage Nativo (SQLite persistente compartido dev / build)
    // ========================================================================

    pub fn plugin_storage_get(&self, plugin_id: &str, key: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT val FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query(params![plugin_id, key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn plugin_storage_set(&self, plugin_id: &str, key: &str, val: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO plugin_storage (plugin_id, key, val, updated_at) VALUES (?1, ?2, ?3, strftime('%s', 'now'))",
            params![plugin_id, key, val],
        )?;
        Ok(())
    }

    pub fn plugin_storage_delete(&self, plugin_id: &str, key: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
            params![plugin_id, key],
        )?;
        Ok(())
    }

    pub fn plugin_storage_list_keys(&self, plugin_id: &str) -> rusqlite::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key FROM plugin_storage WHERE plugin_id = ?1 ORDER BY key ASC")?;
        let rows = stmt.query_map(params![plugin_id], |row| row.get(0))?;
        let mut keys = Vec::new();
        for k in rows {
            keys.push(k?);
        }
        Ok(keys)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fts5_ingest_and_instant_search() {
        let db = Database::in_memory().unwrap();

        let source = Source {
            id: "src_test".to_string(),
            name: "Biblioteca de Juegos".to_string(),
            active: true,
            count: 3,
            mapping: None,
            pkg: None,
            flags: None,
        };

        let items = vec![
            UnifiedItem {
                id: "1".to_string(),
                source_id: "src_test".to_string(),
                source_name: "Biblioteca de Juegos".to_string(),
                title: "Cyberpunk 2077 Phantom Liberty".to_string(),
                subtitle: Some("RPG de acción futurista".to_string()),
                file_size: Some("70 GB".to_string()),
                file_size_bytes: None,
                link: Some("https://example.com/cyberpunk".to_string()),
                raw: None,
            },
            UnifiedItem {
                id: "2".to_string(),
                source_id: "src_test".to_string(),
                source_name: "Biblioteca de Juegos".to_string(),
                title: "The Witcher 3 Wild Hunt".to_string(),
                subtitle: Some("Fantasía épica medieval".to_string()),
                file_size: Some("50 GB".to_string()),
                file_size_bytes: None,
                link: Some("magnet:?xt=urn:btih:witcher3".to_string()),
                raw: None,
            },
            UnifiedItem {
                id: "3".to_string(),
                source_id: "src_test".to_string(),
                source_name: "Biblioteca de Juegos".to_string(),
                title: "Hollow Knight Silksong".to_string(),
                subtitle: Some("Metroidvania desafiante".to_string()),
                file_size: Some("8 GB".to_string()),
                file_size_bytes: None,
                link: None,
                raw: None,
            },
        ];

        db.insert_source_with_items(&source, None, &items).unwrap();

        // 1. Búsqueda vacía (todos)
        let res_all = db.search("", None, "relevance", 10, 0).unwrap();
        assert_eq!(res_all.total, 3);
        assert_eq!(res_all.items.len(), 3);

        // 2. Búsqueda FTS5 por prefijo/término
        let res_search = db.search("cyber", None, "relevance", 10, 0).unwrap();
        assert_eq!(res_search.total, 1);
        assert_eq!(res_search.items[0].title, "Cyberpunk 2077 Phantom Liberty");
        assert!(res_search.took_ms < 10.0, "La búsqueda debe ser ultrarrápida");

        // 3. Filtro por enlace
        let res_link = db.search("", Some("link"), "relevance", 10, 0).unwrap();
        assert_eq!(res_link.total, 2);

        let res_nolink = db.search("", Some("nolink"), "relevance", 10, 0).unwrap();
        assert_eq!(res_nolink.total, 1);
        assert_eq!(res_nolink.items[0].title, "Hollow Knight Silksong");
    }

    #[test]
    fn test_update_source_mapping_and_flags() {
        let db = Database::in_memory().unwrap();
        let source = Source {
            id: "src_map".to_string(),
            name: "Canales".to_string(),
            active: true,
            count: 1,
            mapping: None,
            pkg: None,
            flags: None,
        };
        let items = vec![UnifiedItem {
            id: "1".to_string(),
            source_id: "src_map".to_string(),
            source_name: "Canales".to_string(),
            title: "DAZN F1".to_string(),
            subtitle: None,
            file_size: None,
            file_size_bytes: None,
            link: Some("https://stream.example/f1".to_string()),
            raw: None,
        }];

        db.insert_source_with_items(&source, Some("{\"raw\": 123}"), &items).unwrap();

        let mut flags = std::collections::HashMap::new();
        flags.insert("streaming".to_string(), true);

        let new_mapping = MappingConfig {
            title_key: Some("name".to_string()),
            link_key: Some("url".to_string()),
            subtitle_key: None,
        };

        let new_items = vec![UnifiedItem {
            id: "1".to_string(),
            source_id: "src_map".to_string(),
            source_name: "Canales TV".to_string(),
            title: "DAZN LALIGA".to_string(),
            subtitle: Some("Fútbol en directo".to_string()),
            file_size: None,
            file_size_bytes: None,
            link: Some("https://stream.example/laliga".to_string()),
            raw: None,
        }];

        db.update_source_mapping_and_items(
            "src_map",
            "Canales TV",
            Some(&new_mapping),
            Some(&flags),
            &new_items,
        )
        .unwrap();

        let sources = db.get_sources().unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].name, "Canales TV");
        assert_eq!(sources[0].count, 1);
        assert!(sources[0].mapping.is_some());
        assert_eq!(sources[0].mapping.as_ref().unwrap().title_key.as_deref(), Some("name"));
        assert!(sources[0].flags.is_some());
        assert_eq!(sources[0].flags.as_ref().unwrap().get("streaming"), Some(&true));

        let res = db.search("laliga", None, "relevance", 10, 0).unwrap();
        assert_eq!(res.total, 1);
        assert_eq!(res.items[0].title, "DAZN LALIGA");
        assert_eq!(res.items[0].source_name, "Canales TV");
    }

    #[test]
    fn test_numeric_file_size_sorting() {
        let db = Database::in_memory().unwrap();
        let source = Source {
            id: "src_sizes".to_string(),
            name: "Sizes".to_string(),
            active: true,
            count: 3,
            mapping: None,
            pkg: None,
            flags: None,
        };

        let items = vec![
            UnifiedItem {
                id: "1".to_string(),
                source_id: "src_sizes".to_string(),
                source_name: "Sizes".to_string(),
                title: "Small File".to_string(),
                subtitle: None,
                file_size: Some("2 MB".to_string()),
                file_size_bytes: None,
                link: None,
                raw: None,
            },
            UnifiedItem {
                id: "2".to_string(),
                source_id: "src_sizes".to_string(),
                source_name: "Sizes".to_string(),
                title: "Large File".to_string(),
                subtitle: None,
                file_size: Some("10 GB".to_string()),
                file_size_bytes: None,
                link: None,
                raw: None,
            },
            UnifiedItem {
                id: "3".to_string(),
                source_id: "src_sizes".to_string(),
                source_name: "Sizes".to_string(),
                title: "Medium File".to_string(),
                subtitle: None,
                file_size: Some("500 MB".to_string()),
                file_size_bytes: None,
                link: None,
                raw: None,
            },
        ];

        db.insert_source_with_items(&source, None, &items).unwrap();

        // Orden descendente por tamaño
        let desc = db.search("", None, "size-desc", 10, 0).unwrap();
        assert_eq!(desc.items[0].title, "Large File");
        assert_eq!(desc.items[1].title, "Medium File");
        assert_eq!(desc.items[2].title, "Small File");

        // Orden ascendente por tamaño
        let asc = db.search("", None, "size-asc", 10, 0).unwrap();
        assert_eq!(asc.items[0].title, "Small File");
        assert_eq!(asc.items[1].title, "Medium File");
        assert_eq!(asc.items[2].title, "Large File");
    }

    #[test]
    fn test_fts5_quote_phrase_sanitizer() {
        let db = Database::in_memory().unwrap();
        let source = Source {
            id: "src_phrases".to_string(),
            name: "Phrases".to_string(),
            active: true,
            count: 2,
            mapping: None,
            pkg: None,
            flags: None,
        };

        let items = vec![
            UnifiedItem {
                id: "1".to_string(),
                source_id: "src_phrases".to_string(),
                source_name: "Phrases".to_string(),
                title: "Super Mario Odyssey".to_string(),
                subtitle: None,
                file_size: None,
                file_size_bytes: None,
                link: None,
                raw: None,
            },
            UnifiedItem {
                id: "2".to_string(),
                source_id: "src_phrases".to_string(),
                source_name: "Phrases".to_string(),
                title: "Mario & Luigi Superstar".to_string(),
                subtitle: None,
                file_size: None,
                file_size_bytes: None,
                link: None,
                raw: None,
            },
        ];

        db.insert_source_with_items(&source, None, &items).unwrap();

        // Búsqueda con frase exacta entre comillas
        let res_exact = db.search("\"Mario Odyssey\"", None, "relevance", 10, 0).unwrap();
        assert_eq!(res_exact.total, 1);
        assert_eq!(res_exact.items[0].title, "Super Mario Odyssey");

        // Búsqueda con caracteres extraños y símbolos no debe fallar ni causar syntax error en SQLite
        let res_safe = db.search("Mario: (Odyssey)*", None, "relevance", 10, 0).unwrap();
        assert_eq!(res_safe.total, 1);
        assert_eq!(res_safe.items[0].title, "Super Mario Odyssey");

        // Búsqueda con comilla desbalanceada no debe provocar syntax error
        let res_unclosed = db.search("Mario \"Odyssey", None, "relevance", 10, 0).unwrap();
        assert_eq!(res_unclosed.total, 1);
    }

    #[test]
    fn test_query_readonly_enforcement() {
        let db = Database::in_memory().unwrap();

        // 1. SELECT debe funcionar
        let rows = db.query_raw_json_readonly("SELECT 1 AS num").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("num").unwrap().as_i64(), Some(1));

        // 2. Modificaciones deben ser bloqueadas a nivel de SQLite (PRAGMA query_only = ON)
        let write_attempt = db.query_raw_json_readonly("CREATE TABLE blocked_table (id INT)");
        assert!(write_attempt.is_err(), "query_raw_json_readonly debe rechazar mutaciones");
    }

    #[test]
    fn test_keychain_crud() {
        let db = Database::in_memory().unwrap();

        assert_eq!(db.keychain_get("test_token").unwrap(), None);

        db.keychain_set("test_token", "secret_value_123").unwrap();
        assert_eq!(db.keychain_get("test_token").unwrap().as_deref(), Some("secret_value_123"));

        db.keychain_set("test_token", "updated_value_456").unwrap();
        assert_eq!(db.keychain_get("test_token").unwrap().as_deref(), Some("updated_value_456"));

        db.keychain_delete("test_token").unwrap();
        assert_eq!(db.keychain_get("test_token").unwrap(), None);
    }

    #[test]
    fn test_insert_sources_batch_preserves_flags() {
        let db = Database::in_memory().unwrap();

        let mut flags = std::collections::HashMap::new();
        flags.insert("isBatchFlag".to_string(), true);

        let source = Source {
            id: "batch_src".to_string(),
            name: "Batch Source".to_string(),
            active: true,
            count: 1,
            mapping: None,
            pkg: None,
            flags: Some(flags),
        };

        let items = vec![UnifiedItem {
            id: "b1".to_string(),
            source_id: "batch_src".to_string(),
            source_name: "Batch Source".to_string(),
            title: "Item 1".to_string(),
            subtitle: None,
            file_size: Some("100 KB".to_string()),
            file_size_bytes: None,
            link: None,
            raw: None,
        }];

        db.insert_sources_batch(&[(source, None, items)]).unwrap();

        let sources = db.get_sources().unwrap();
        assert_eq!(sources.len(), 1);
        assert!(sources[0].flags.is_some(), "insert_sources_batch debe persistir flags_json");
        assert_eq!(sources[0].flags.as_ref().unwrap().get("isBatchFlag"), Some(&true));
    }

    #[test]
    fn test_legacy_migration_without_file_size_bytes() {
        let db_path = std::env::temp_dir().join(format!(
            "test_legacy_{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        // 1. Simular base de datos legacy creada por versión previa sin file_size_bytes
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch("
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    mapping_json TEXT,
                    pkg_json TEXT,
                    raw_content TEXT
                );

                CREATE TABLE items (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    source_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    subtitle TEXT,
                    file_size TEXT,
                    link TEXT,
                    raw_json TEXT
                );

                INSERT INTO items (id, source_id, source_name, title, file_size)
                VALUES ('legacy1', 'src1', 'Legacy Source', 'Ubuntu Linux', '2.5 GB');
            ").unwrap();
        }

        // 2. Abrir con Database::new: debe migrar sin panics
        let db = Database::new(&db_path).expect("La inicialización debe migrar la base de datos legacy sin fallos");

        // 3. Verificar que file_size_bytes fue añadido y retro-rellenado (backfill)
        let file_size_bytes: Option<i64> = db.conn.lock().unwrap().query_row(
            "SELECT file_size_bytes FROM items WHERE id = 'legacy1'",
            [],
            |row| row.get(0),
        ).unwrap();

        assert_eq!(file_size_bytes, Some(2684354560)); // 2.5 GB en bytes

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_schema_migrations_are_versioned_and_idempotent() {
        let db_path = std::env::temp_dir().join(format!(
            "test_migrations_{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        // Base de datos legacy: user_version = 0, sin flags_json ni file_size_bytes.
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    mapping_json TEXT,
                    pkg_json TEXT,
                    raw_content TEXT
                );

                CREATE TABLE items (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    source_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    subtitle TEXT,
                    file_size TEXT,
                    link TEXT,
                    raw_json TEXT
                );

                INSERT INTO sources (id, name, active) VALUES ('src1', 'Legacy Source', 1);
                INSERT INTO items (id, source_id, source_name, title, file_size)
                VALUES ('legacy1', 'src1', 'Legacy Source', 'Ubuntu Linux', '2.5 GB');
                ",
            )
            .unwrap();
        }

        // Primera apertura: aplica todas las migraciones y reconstruye FTS una vez.
        {
            let db = Database::new(&db_path).expect("La migración inicial debe completarse");
            assert_eq!(db.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
            let res = db.search("ubuntu", None, "relevance", 10, 0).unwrap();
            assert_eq!(res.total, 1);
            assert_eq!(res.items[0].file_size_bytes, Some(2684354560));
        }

        // Segunda apertura: no debe re-migrar ni reconstruir FTS; los datos persisten.
        {
            let db = Database::new(&db_path).expect("La reapertura no debe fallar");
            assert_eq!(db.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
            let res = db.search("ubuntu", None, "relevance", 10, 0).unwrap();
            assert_eq!(res.total, 1);

            // La reparación explícita sigue disponible bajo demanda.
            db.rebuild_fts().unwrap();
            assert_eq!(db.search("ubuntu", None, "relevance", 10, 0).unwrap().total, 1);
            db.vacuum().unwrap();
        }

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_scale_measurement_5000_items() {
        let db = Database::in_memory().unwrap();
        let source = Source {
            id: "src_scale".to_string(),
            name: "Scale Source".to_string(),
            active: true,
            count: 5000,
            mapping: None,
            pkg: None,
            flags: None,
        };

        let items: Vec<UnifiedItem> = (0..5000)
            .map(|i| UnifiedItem {
                id: format!("scale-{}", i),
                source_id: "src_scale".to_string(),
                source_name: "Scale Source".to_string(),
                title: format!("Game {} Deluxe Edition", i),
                subtitle: Some(format!("Item de escala {}", i)),
                file_size: Some(format!("{} MB", (i % 900) + 1)),
                file_size_bytes: None,
                link: None,
                raw: None,
            })
            .collect();

        let ingest_start = Instant::now();
        db.insert_source_with_items(&source, None, &items).unwrap();
        let ingest_ms = ingest_start.elapsed().as_secs_f64() * 1000.0;

        let search_start = Instant::now();
        let res = db.search("game", None, "relevance", 50, 0).unwrap();
        let search_ms = search_start.elapsed().as_secs_f64() * 1000.0;

        println!(
            "[scale] 5000 items: ingesta={:.1}ms búsqueda={:.1}ms total={}",
            ingest_ms, search_ms, res.total
        );

        assert_eq!(res.total, 5000);
        assert_eq!(res.items.len(), 50);
    }
}
