// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::PathBuf;
use std::sync::Mutex;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{ErrorData as McpError, ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use rusqlite::{Connection, OpenFlags};

const MAX_PAGE: u32 = 200;
const PREVIEW_CHARS: usize = 240;

#[derive(serde::Serialize)]
struct NoteSummary {
    id: String,
    title: String,
    preview: String,
    folder_id: Option<String>,
    updated_at: i64,
    is_pinned: bool,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct ListNotes {
    /// Only return notes in this folder id.
    folder_id: Option<String>,
    /// Max notes to return (1-200, default 50).
    limit: Option<u32>,
    /// Number of notes to skip.
    offset: Option<u32>,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct SearchNotes {
    /// Text to find in note titles and Markdown content.
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct GetNote {
    /// Stable note id from list_notes or search_notes.
    id: String,
}

struct Workspace {
    conn: Mutex<Connection>,
    has_pinned: bool,
    has_folder: bool,
    has_sort_order: bool,
}

fn has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
        rusqlite::params![table, column],
        |row| row.get(0),
    )
}

impl Workspace {
    fn open(path: &PathBuf) -> Result<Self, String> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| format!("Could not open workspace read-only: {e}"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.create_scalar_function(
            "lower_u",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8
                | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(ctx.get::<String>(0)?.to_lowercase()),
        )
        .map_err(|e| e.to_string())?;

        let has_notes: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes')",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Not a readable SQLite workspace: {e}"))?;
        if !has_notes {
            return Err("This file has no `notes` table; it is not a Scratchpad workspace.".into());
        }

        Ok(Self {
            has_pinned: has_column(&conn, "notes", "isPinned").map_err(|e| e.to_string())?,
            has_folder: has_column(&conn, "notes", "folderId").map_err(|e| e.to_string())?,
            has_sort_order: has_column(&conn, "notes", "sortOrder").map_err(|e| e.to_string())?,
            conn: Mutex::new(conn),
        })
    }

    fn select_list(&self) -> String {
        let pinned = if self.has_pinned { "isPinned" } else { "0" };
        let folder = if self.has_folder { "folderId" } else { "NULL" };
        let order = if self.has_sort_order {
            "sortOrder ASC, updatedAt DESC"
        } else {
            "updatedAt DESC"
        };
        format!(
            "SELECT id, title, content, updatedAt, {pinned}, {folder} FROM notes {{where}} ORDER BY {order} LIMIT ?1 OFFSET ?2"
        )
    }
}

fn preview(content: &str) -> String {
    let flat: String = content.chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
    let trimmed = flat.trim();
    if trimmed.chars().count() <= PREVIEW_CHARS {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(PREVIEW_CHARS).collect();
    format!("{cut}…")
}

fn bounded(limit: Option<u32>) -> u32 {
    limit.unwrap_or(50).clamp(1, MAX_PAGE)
}

fn json_result<T: serde::Serialize>(value: &T) -> Result<rmcp::model::CallToolResult, McpError> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
    Ok(rmcp::model::CallToolResult::success(vec![
        rmcp::model::ContentBlock::text(text),
    ]))
}

#[derive(Clone)]
struct Server {
    workspace: std::sync::Arc<Workspace>,
    tool_router: ToolRouter<Server>,
}

#[tool_router]
impl Server {
    /// List note metadata and short previews from the connected Scratchpad workspace.
    #[tool(annotations(title = "List notes", read_only_hint = true, destructive_hint = false, open_world_hint = false))]
    async fn list_notes(
        &self,
        Parameters(args): Parameters<ListNotes>,
    ) -> Result<rmcp::model::CallToolResult, McpError> {
        let limit = bounded(args.limit);
        let offset = args.offset.unwrap_or(0);
        let ws = &self.workspace;
        let conn = ws.conn.lock().unwrap();

        let filtering = args.folder_id.is_some() && ws.has_folder;
        let clause = if filtering { "WHERE folderId = ?3" } else { "" };
        let sql = ws.select_list().replace("{where}", clause);
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;

        let map = |row: &rusqlite::Row| -> rusqlite::Result<NoteSummary> {
            let content: String = row.get(2)?;
            Ok(NoteSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                preview: preview(&content),
                updated_at: row.get(3)?,
                is_pinned: row.get::<_, i64>(4)? != 0,
                folder_id: row.get(5)?,
            })
        };

        let rows: Vec<NoteSummary> = if filtering {
            let folder = args.folder_id.clone().unwrap();
            stmt.query_map(rusqlite::params![limit, offset, folder], map)
                .and_then(|iter| iter.collect())
        } else {
            stmt.query_map(rusqlite::params![limit, offset], map)
                .and_then(|iter| iter.collect())
        }
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        let next_offset = if rows.len() as u32 == limit {
            Some(offset + limit)
        } else {
            None
        };
        json_result(&serde_json::json!({ "notes": rows, "nextOffset": next_offset }))
    }

    /// Search note titles and Markdown content in the connected workspace.
    #[tool(annotations(title = "Search notes", read_only_hint = true, destructive_hint = false, open_world_hint = false))]
    async fn search_notes(
        &self,
        Parameters(args): Parameters<SearchNotes>,
    ) -> Result<rmcp::model::CallToolResult, McpError> {
        if args.query.trim().is_empty() {
            return Err(McpError::invalid_params("query must not be empty", None));
        }
        let limit = bounded(args.limit);
        let offset = args.offset.unwrap_or(0);
        let ws = &self.workspace;
        let conn = ws.conn.lock().unwrap();
        let sql = ws
            .select_list()
            .replace(
                "{where}",
                "WHERE lower_u(title) LIKE ?3 ESCAPE '\\' OR lower_u(content) LIKE ?3 ESCAPE '\\'",
            );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        let escaped = args
            .query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{}%", escaped.to_lowercase());
        let iter = stmt
            .query_map(rusqlite::params![limit, offset, pattern], |row| {
                let content: String = row.get(2)?;
                Ok(NoteSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    preview: preview(&content),
                    updated_at: row.get(3)?,
                    is_pinned: row.get::<_, i64>(4)? != 0,
                    folder_id: row.get(5)?,
                })
            })
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        let rows: Vec<NoteSummary> = iter
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        json_result(&serde_json::json!({ "notes": rows }))
    }

    /// Return one complete note by its stable id.
    #[tool(annotations(title = "Get note", read_only_hint = true, destructive_hint = false, open_world_hint = false))]
    async fn get_note(
        &self,
        Parameters(args): Parameters<GetNote>,
    ) -> Result<rmcp::model::CallToolResult, McpError> {
        let ws = &self.workspace;
        let conn = ws.conn.lock().unwrap();
        let folder = if ws.has_folder { "folderId" } else { "NULL" };
        let sql = format!("SELECT id, title, content, updatedAt, {folder} FROM notes WHERE id = ?1");
        let found = conn.query_row(&sql, rusqlite::params![args.id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "updatedAt": row.get::<_, i64>(3)?,
                "folderId": row.get::<_, Option<String>>(4)?,
            }))
        });
        match found {
            Ok(note) => json_result(&note),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(McpError::invalid_params("No note with that id", None))
            }
            Err(e) => Err(McpError::internal_error(e.to_string(), None)),
        }
    }
}

#[tool_handler]
impl ServerHandler for Server {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "Read-only access to one local Scratchpad workspace (a SQLite file). \
             Results are paginated; use nextOffset to continue. Writes are unavailable. \
             Notes stored only in the Scratchpad desktop app's local collection are not \
             visible here until they are migrated to a portable workspace.",
        )
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mut path: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        if arg == "--workspace" {
            path = args.next().map(PathBuf::from);
        }
    }
    let path = path.ok_or("usage: scratchpad-mcp --workspace /absolute/path/to/notes.sqlite")?;
    let path = std::fs::canonicalize(&path)
        .map_err(|e| format!("Cannot resolve workspace {}: {e}", path.display()))?;
    eprintln!("scratchpad-mcp: serving {}", path.display());

    let workspace = Workspace::open(&path)?;
    let server = Server {
        workspace: std::sync::Arc::new(workspace),
        tool_router: Server::tool_router(),
    };
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}