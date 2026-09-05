// SPDX-License-Identifier: GPL-3.0-or-later

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

mod mcp;
pub use mcp::run_mcp_stdio;

const PREFERENCES_FILE_NAME: &str = "scratchpad-preferences.json";

#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppPreferences {
    last_workspace: Option<String>,
}

fn read_preferences(path: &Path) -> Result<Option<AppPreferences>, String> {
    match fs::read(path) {
        Ok(contents) => serde_json::from_slice(&contents)
            .map(Some)
            .map_err(|e| format!("Could not parse native preferences: {e}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read native preferences: {error}")),
    }
}

fn write_preferences(path: &Path, preferences: &AppPreferences) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Native preferences path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Could not create native preferences directory: {e}"))?;
    let contents = serde_json::to_vec_pretty(preferences)
        .map_err(|e| format!("Could not serialize native preferences: {e}"))?;
    fs::write(path, contents).map_err(|e| format!("Could not write native preferences: {e}"))
}

fn load_workspace_preference_from(
    path: &Path,
    legacy_path: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(preferences) = read_preferences(path)? {
        return Ok(preferences.last_workspace);
    }

    let migrated_path = legacy_path.filter(|value| !value.is_empty());
    write_preferences(
        path,
        &AppPreferences {
            last_workspace: migrated_path.clone(),
        },
    )?;
    Ok(migrated_path)
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(PREFERENCES_FILE_NAME))
        .map_err(|e| format!("Could not resolve native preferences directory: {e}"))
}

#[tauri::command]
fn load_workspace_preference(
    app: tauri::AppHandle,
    legacy_path: Option<String>,
) -> Result<Option<String>, String> {
    load_workspace_preference_from(&preferences_path(&app)?, legacy_path)
}

#[tauri::command]
fn set_last_workspace(app: tauri::AppHandle, db_path: Option<String>) -> Result<(), String> {
    write_preferences(
        &preferences_path(&app)?,
        &AppPreferences {
            last_workspace: db_path,
        },
    )
}

// Note struct representation matching frontend note
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Note {
    id: String,
    title: String,
    content: String,
    updated_at: i64,
    is_title_locked: bool,
    #[serde(default)]
    is_pinned: bool,
    #[serde(default)]
    folder_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(crate) struct Folder {
    id: String,
    name: String,
}

fn ensure_workspace_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            updatedAt INTEGER NOT NULL,
            isTitleLocked INTEGER NOT NULL,
            isPinned INTEGER NOT NULL DEFAULT 0,
            folderId TEXT,
            sortOrder INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let has_sort_order: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('notes') WHERE name = 'sortOrder'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !has_sort_order {
        conn.execute(
            "ALTER TABLE notes ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    let has_is_pinned: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('notes') WHERE name = 'isPinned'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !has_is_pinned {
        conn.execute(
            "ALTER TABLE notes ADD COLUMN isPinned INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    let has_folder_id: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('notes') WHERE name = 'folderId'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !has_folder_id {
        conn.execute("ALTER TABLE notes ADD COLUMN folderId TEXT", [])
            .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sortOrder INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn save_file_native(content: String, default_name: String) -> Result<String, String> {
    let file_path = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .save_file();

    if let Some(path) = file_path {
        let mut file = File::create(&path).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Cancelled".to_string())
    }
}

#[derive(serde::Serialize)]
struct ImportedFile {
    title: String,
    content: String,
}

#[tauri::command]
fn import_file_native() -> Result<Option<ImportedFile>, String> {
    let file_path = rfd::FileDialog::new().pick_file();

    if let Some(path) = file_path {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Imported Note")
            .to_string();

        let title = if let Some(idx) = name.rfind('.') {
            if idx > 0 {
                name[..idx].to_string()
            } else {
                name.clone()
            }
        } else {
            name.clone()
        };

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => {
                rfd::MessageDialog::new()
                    .set_title("Unsupported File Format")
                    .set_description(format!(
                        "The file \"{}\" could not be opened because it is not a valid text file.\n\nOnly text-encoded files (Markdown, source code, config files, plain text) can be imported into Scratchpad.",
                        name
                    ))
                    .set_buttons(rfd::MessageButtons::Ok)
                    .show();
                return Ok(None);
            }
        };
        Ok(Some(ImportedFile { title, content }))
    } else {
        Ok(None)
    }
}

// Database commands
#[tauri::command]
fn select_db_file() -> Result<Option<String>, String> {
    const OPEN_EXISTING: &str = "Open Existing Workspace";
    const CREATE_NEW: &str = "Create New Workspace";
    const CANCEL: &str = "Cancel";

    let choice = rfd::MessageDialog::new()
        .set_title("Choose a Scratchpad Workspace")
        .set_description("Open an existing Scratchpad workspace, or create a new one.")
        .set_buttons(rfd::MessageButtons::YesNoCancelCustom(
            OPEN_EXISTING.to_string(),
            CREATE_NEW.to_string(),
            CANCEL.to_string(),
        ))
        .show();

    let file_path = match choice {
        rfd::MessageDialogResult::Custom(action) if action == OPEN_EXISTING => {
            rfd::FileDialog::new()
                .set_title("Open Scratchpad Workspace")
                .add_filter("Scratchpad Workspace", &["db", "sqlite"])
                .pick_file()
        }
        rfd::MessageDialogResult::Custom(action) if action == CREATE_NEW => rfd::FileDialog::new()
            .set_title("Create Scratchpad Workspace")
            .set_file_name("scratchpad.db")
            .add_filter("Scratchpad Workspace", &["db", "sqlite"])
            .save_file(),
        // These fallbacks preserve the intended behavior on any native backend
        // that reports standard results for custom-labeled buttons.
        rfd::MessageDialogResult::Yes => rfd::FileDialog::new()
            .set_title("Open Scratchpad Workspace")
            .add_filter("Scratchpad Workspace", &["db", "sqlite"])
            .pick_file(),
        rfd::MessageDialogResult::No => rfd::FileDialog::new()
            .set_title("Create Scratchpad Workspace")
            .set_file_name("scratchpad.db")
            .add_filter("Scratchpad Workspace", &["db", "sqlite"])
            .save_file(),
        _ => None,
    };

    Ok(file_path.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn load_db_notes(db_path: String) -> Result<Vec<Note>, String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_workspace_schema(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, updatedAt, isTitleLocked, isPinned, folderId
             FROM notes
             ORDER BY sortOrder ASC, updatedAt DESC",
        )
        .map_err(|e| e.to_string())?;

    let note_iter = stmt
        .query_map([], |row| {
            let is_title_locked_int: i32 = row.get(4)?;
            let is_pinned_int: i32 = row.get(5)?;
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                updated_at: row.get(3)?,
                is_title_locked: is_title_locked_int != 0,
                is_pinned: is_pinned_int != 0,
                folder_id: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    for note in note_iter {
        notes.push(note.map_err(|e| e.to_string())?);
    }
    Ok(notes)
}

#[tauri::command]
fn save_note_db(db_path: String, note: Note, sort_order: i64) -> Result<(), String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_workspace_schema(&conn)?;

    conn.execute(
        "INSERT INTO notes (
            id, title, content, updatedAt, isTitleLocked, isPinned, folderId, sortOrder
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            updatedAt = excluded.updatedAt,
            isTitleLocked = excluded.isTitleLocked,
            isPinned = excluded.isPinned,
            folderId = excluded.folderId,
            sortOrder = excluded.sortOrder",
        rusqlite::params![
            note.id,
            note.title,
            note.content,
            note.updated_at,
            if note.is_title_locked { 1 } else { 0 },
            if note.is_pinned { 1 } else { 0 },
            note.folder_id,
            sort_order,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn save_notes_db(db_path: String, notes: Vec<Note>) -> Result<(), String> {
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_workspace_schema(&conn)?;

    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM notes", [])
        .map_err(|e| e.to_string())?;

    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO notes (
                    id, title, content, updatedAt, isTitleLocked, isPinned, folderId, sortOrder
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|e| e.to_string())?;

        for (sort_order, note) in notes.into_iter().enumerate() {
            statement
                .execute(rusqlite::params![
                    note.id,
                    note.title,
                    note.content,
                    note.updated_at,
                    if note.is_title_locked { 1 } else { 0 },
                    if note.is_pinned { 1 } else { 0 },
                    note.folder_id,
                    sort_order as i64,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_db_folders(db_path: String) -> Result<Vec<Folder>, String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_workspace_schema(&conn)?;

    let mut stmt = conn
        .prepare("SELECT id, name FROM folders ORDER BY sortOrder ASC, name COLLATE NOCASE ASC")
        .map_err(|e| e.to_string())?;
    let folder_iter = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut folders = Vec::new();
    for folder in folder_iter {
        folders.push(folder.map_err(|e| e.to_string())?);
    }
    Ok(folders)
}

#[tauri::command]
fn save_folders_db(db_path: String, folders: Vec<Folder>) -> Result<(), String> {
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_workspace_schema(&conn)?;

    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM folders", [])
        .map_err(|e| e.to_string())?;

    {
        let mut statement = transaction
            .prepare("INSERT INTO folders (id, name, sortOrder) VALUES (?1, ?2, ?3)")
            .map_err(|e| e.to_string())?;
        for (sort_order, folder) in folders.into_iter().enumerate() {
            statement
                .execute(rusqlite::params![folder.id, folder.name, sort_order as i64])
                .map_err(|e| e.to_string())?;
        }
    }

    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_workspace_db(
    db_path: String,
    notes: Vec<Note>,
    folders: Vec<Folder>,
) -> Result<(), String> {
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_workspace_schema(&conn)?;

    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM notes", [])
        .map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM folders", [])
        .map_err(|e| e.to_string())?;

    {
        let mut statement = transaction
            .prepare("INSERT INTO folders (id, name, sortOrder) VALUES (?1, ?2, ?3)")
            .map_err(|e| e.to_string())?;
        for (sort_order, folder) in folders.into_iter().enumerate() {
            statement
                .execute(rusqlite::params![folder.id, folder.name, sort_order as i64])
                .map_err(|e| e.to_string())?;
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO notes (
                    id, title, content, updatedAt, isTitleLocked, isPinned, folderId, sortOrder
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|e| e.to_string())?;
        for (sort_order, note) in notes.into_iter().enumerate() {
            statement
                .execute(rusqlite::params![
                    note.id,
                    note.title,
                    note.content,
                    note.updated_at,
                    if note.is_title_locked { 1 } else { 0 },
                    if note.is_pinned { 1 } else { 0 },
                    note.folder_id,
                    sort_order as i64,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn show_alert_dialog(title: String, message: String) {
    rfd::MessageDialog::new()
        .set_title(&title)
        .set_description(&message)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(mcp::McpState::default())
        // Markdown links have no default handling in the webview; the opener
        // plugin sends them to the user's browser instead. Its capability scope
        // limits it to the same schemes the Markdown sanitizer allows.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_workspace_preference,
            set_last_workspace,
            save_file_native,
            import_file_native,
            select_db_file,
            load_db_notes,
            load_db_folders,
            save_note_db,
            save_notes_db,
            save_folders_db,
            save_workspace_db,
            show_alert_dialog,
            mcp::update_mcp_snapshot,
            mcp::update_mcp_note,
            mcp::start_mcp_server,
            mcp::stop_mcp_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_db_path(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "scratchpad-{test_name}-{}-{unique}.sqlite",
            std::process::id()
        ))
    }

    fn note(id: &str, content: &str, updated_at: i64) -> Note {
        Note {
            id: id.to_string(),
            title: format!("Note {id}"),
            content: content.to_string(),
            updated_at,
            is_title_locked: false,
            is_pinned: false,
            folder_id: None,
        }
    }

    fn folder(id: &str, name: &str) -> Folder {
        Folder {
            id: id.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn migrates_legacy_workspace_once_and_respects_an_explicit_disconnect() {
        let path = temporary_db_path("native-preferences").with_extension("json");
        let legacy_path = "/tmp/legacy-workspace.db".to_string();

        let migrated = load_workspace_preference_from(&path, Some(legacy_path.clone()))
            .expect("legacy preference should migrate");
        assert_eq!(migrated, Some(legacy_path));

        write_preferences(
            &path,
            &AppPreferences {
                last_workspace: None,
            },
        )
        .expect("disconnect should be persisted");

        let stale_legacy = load_workspace_preference_from(
            &path,
            Some("/tmp/stale-origin-workspace.db".to_string()),
        )
        .expect("native preference should take precedence");
        assert_eq!(stale_legacy, None);

        std::fs::remove_file(path).expect("temporary preferences should be removable");
    }

    #[test]
    fn saves_the_complete_workspace_in_sidebar_order() {
        let path = temporary_db_path("ordered-workspace");
        let db_path = path.to_string_lossy().into_owned();

        save_notes_db(
            db_path.clone(),
            vec![note("older", "left", 1), note("newer", "right", 2)],
        )
        .expect("workspace should save");

        save_note_db(
            db_path.clone(),
            note("newer", "edited in secondary pane", 3),
            1,
        )
        .expect("secondary note should save independently");

        let loaded = load_db_notes(db_path.clone()).expect("workspace should load");
        assert_eq!(loaded[0].id, "older");
        assert_eq!(loaded[1].content, "edited in secondary pane");

        let mut pinned_note = loaded[1].clone();
        pinned_note.is_pinned = true;
        let reordered = vec![pinned_note, loaded[0].clone()];
        save_notes_db(db_path.clone(), reordered.clone()).expect("workspace should resave");

        let loaded = load_db_notes(db_path).expect("workspace should load");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "newer");
        assert_eq!(loaded[0].content, "edited in secondary pane");
        assert!(loaded[0].is_pinned);
        assert_eq!(loaded[1].id, "older");

        std::fs::remove_file(path).expect("temporary database should be removable");
    }

    #[test]
    fn saves_folders_and_note_assignments_in_sidebar_order() {
        let path = temporary_db_path("folder-workspace");
        let db_path = path.to_string_lossy().into_owned();
        let folders = vec![folder("work", "Work"), folder("personal", "Personal")];
        save_folders_db(db_path.clone(), folders).expect("folders should save");

        let mut assigned = note("assigned", "in work", 1);
        assigned.folder_id = Some("work".to_string());
        save_notes_db(db_path.clone(), vec![assigned]).expect("assigned note should save");

        let loaded_folders = load_db_folders(db_path.clone()).expect("folders should load");
        let loaded_notes = load_db_notes(db_path.clone()).expect("notes should load");
        assert_eq!(loaded_folders[0].id, "work");
        assert_eq!(loaded_folders[1].name, "Personal");
        assert_eq!(loaded_notes[0].folder_id.as_deref(), Some("work"));

        std::fs::remove_file(path).expect("temporary database should be removable");
    }

    #[test]
    fn workspace_structure_save_is_atomic() {
        let path = temporary_db_path("atomic-workspace");
        let db_path = path.to_string_lossy().into_owned();
        let mut original_note = note("original", "keep me", 1);
        original_note.folder_id = Some("original-folder".to_string());
        save_workspace_db(
            db_path.clone(),
            vec![original_note],
            vec![folder("original-folder", "Original")],
        )
        .expect("initial workspace should save");

        let failed = save_workspace_db(
            db_path.clone(),
            vec![note("replacement", "must roll back", 2)],
            vec![folder("duplicate", "One"), folder("duplicate", "Two")],
        );
        assert!(failed.is_err());

        let loaded_notes = load_db_notes(db_path.clone()).expect("original notes should remain");
        let loaded_folders =
            load_db_folders(db_path.clone()).expect("original folders should remain");
        assert_eq!(loaded_notes.len(), 1);
        assert_eq!(loaded_notes[0].id, "original");
        assert_eq!(loaded_notes[0].content, "keep me");
        assert_eq!(loaded_folders.len(), 1);
        assert_eq!(loaded_folders[0].name, "Original");

        std::fs::remove_file(path).expect("temporary database should be removable");
    }

    #[test]
    fn migrates_existing_databases_without_ordering_columns() {
        let path = temporary_db_path("migration");
        let db_path = path.to_string_lossy().into_owned();
        let connection = rusqlite::Connection::open(&db_path).expect("database should open");
        connection
            .execute(
                "CREATE TABLE notes (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    updatedAt INTEGER NOT NULL,
                    isTitleLocked INTEGER NOT NULL
                )",
                [],
            )
            .expect("legacy schema should be created");
        drop(connection);

        let loaded = load_db_notes(db_path).expect("legacy schema should migrate");
        assert!(loaded.is_empty());

        let connection = rusqlite::Connection::open(&path).expect("database should reopen");
        let has_sort_order: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM pragma_table_info('notes') WHERE name = 'sortOrder'
                )",
                [],
                |row| row.get(0),
            )
            .expect("migration should be queryable");
        assert!(has_sort_order);
        let has_is_pinned: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM pragma_table_info('notes') WHERE name = 'isPinned'
                )",
                [],
                |row| row.get(0),
            )
            .expect("pin migration should be queryable");
        assert!(has_is_pinned);
        let has_folder_id: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM pragma_table_info('notes') WHERE name = 'folderId'
                )",
                [],
                |row| row.get(0),
            )
            .expect("folder migration should be queryable");
        assert!(has_folder_id);
        let has_folders_table: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'folders'
                )",
                [],
                |row| row.get(0),
            )
            .expect("folders table should be queryable");
        assert!(has_folders_table);
        drop(connection);

        std::fs::remove_file(path).expect("temporary database should be removable");
    }
}
