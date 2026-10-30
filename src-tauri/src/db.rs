// src-tauri/src/db.rs — Motor de base de datos SQLite con FTS5 embebido
use crate::models::{MappingConfig, SearchResult, Source, UnifiedItem};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

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
        let conn = self.conn.lock().unwrap();

        // Optimizaciones de rendimiento SQLite
        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000; -- 64MB de cache
            PRAGMA temp_store = MEMORY;
        ")?;

        conn.execute_batch("
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
                link TEXT,
                raw_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);

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

        // Migración idónea si la tabla ya existía
        let _ = conn.execute("ALTER TABLE sources ADD COLUMN flags_json TEXT", []);

        // Limpieza de fuentes corruptas o imports binarios no válidos de versiones previas
        let _ = conn.execute(
            "DELETE FROM items WHERE source_id IN (SELECT id FROM sources WHERE name LIKE '%.torrent' OR name LIKE '%FOjsK%' OR name LIKE '%url-list%' OR name LIKE '%announce%')",
            [],
        );
        let _ = conn.execute(
            "DELETE FROM sources WHERE name LIKE '%.torrent' OR name LIKE '%FOjsK%' OR name LIKE '%url-list%' OR name LIKE '%announce%'",
            [],
        );
        let _ = conn.execute("VACUUM", []);

        Ok(())
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
                "INSERT INTO items (id, source_id, source_name, title, subtitle, file_size, link, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;

            for it in items {
                stmt.execute(params![
                    it.id,
                    it.source_id,
                    it.source_name,
                    it.title,
                    it.subtitle,
                    it.file_size,
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

            tx.execute(
                "INSERT OR REPLACE INTO sources (id, name, active, mapping_json, pkg_json, raw_content) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    source.id,
                    source.name,
                    if source.active { 1 } else { 0 },
                    mapping_str,
                    pkg_str,
                    raw_content.as_deref(),
                ],
            )?;

            tx.execute("DELETE FROM items WHERE source_id = ?1", params![source.id])?;

            {
                let mut stmt = tx.prepare(
                    "INSERT INTO items (id, source_id, source_name, title, subtitle, file_size, link, raw_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                )?;

                for it in items {
                    stmt.execute(params![
                        it.id,
                        it.source_id,
                        it.source_name,
                        it.title,
                        it.subtitle,
                        it.file_size,
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
                "INSERT INTO items (id, source_id, source_name, title, subtitle, file_size, link, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;

            for it in items {
                stmt.execute(params![
                    it.id,
                    it.source_id,
                    it.source_name,
                    it.title,
                    it.subtitle,
                    it.file_size,
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
            "SELECT id, source_id, source_name, title, subtitle, file_size, link, raw_json
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
            "SELECT id, source_id, source_name, title, subtitle, file_size, link, raw_json
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

        let order_clause = match sort_by {
            "title-asc" => "ORDER BY i.title COLLATE NOCASE ASC",
            "title-desc" => "ORDER BY i.title COLLATE NOCASE DESC",
            "size-desc" => "ORDER BY i.file_size DESC",
            "size-asc" => "ORDER BY i.file_size ASC",
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
                "SELECT i.id, i.source_id, i.source_name, i.title, i.subtitle, i.file_size, i.link, i.raw_json
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
                })
            })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            (list, total)
        } else {
            // Búsqueda FTS5 con términos comodín: "palabra1* palabra2*"
            let fts_terms: Vec<String> = q_clean
                .split_whitespace()
                .filter(|s| !s.is_empty())
                .map(|s| {
                    let sanitized: String = s.chars().filter(|c| c.is_alphanumeric()).collect();
                    if sanitized.is_empty() {
                        format!("\"{}\"", s.replace('"', "\"\""))
                    } else {
                        format!("{}*", sanitized)
                    }
                })
                .collect();

            let fts_query = fts_terms.join(" ");

            let count_sql = format!(
                "SELECT COUNT(*)
                 FROM items_fts f
                 JOIN items i ON f.rowid = i.rowid
                 WHERE items_fts MATCH ?1 AND i.source_id IN (SELECT id FROM sources WHERE active = 1) {}",
                filter_clause
            );

            let mut total_stmt = conn.prepare(&count_sql)?;
            let total: usize = total_stmt.query_row(params![&fts_query], |r| r.get(0)).unwrap_or(0);

            let data_sql = format!(
                "SELECT i.id, i.source_id, i.source_name, i.title, i.subtitle, i.file_size, i.link, i.raw_json
                 FROM items_fts f
                 JOIN items i ON f.rowid = i.rowid
                 WHERE items_fts MATCH ?1 AND i.source_id IN (SELECT id FROM sources WHERE active = 1) {}
                 {} LIMIT ?2 OFFSET ?3",
                filter_clause, order_clause
            );

            let mut stmt = conn.prepare(&data_sql)?;
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
                })
            })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
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
        assert!(res_search.took_ms < 5.0, "La búsqueda debe tardar menos de 5ms");

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
}

