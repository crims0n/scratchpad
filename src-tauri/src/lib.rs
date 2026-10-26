// SPDX-License-Identifier: GPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter, Runtime,
};

mod backup;
mod file_export;
#[cfg(target_os = "macos")]
mod macos_quit;
mod mcp;
#[cfg(test)]
mod native_ipc_tests;
mod note_print;
mod recovery;
#[cfg(test)]
mod test_support;
mod updates;
mod workspace;
pub use mcp::run_mcp_stdio;
use workspace::Workspaces;

const PREFERENCES_FILE_NAME: &str = "scratchpad-preferences.json";

#[cfg(target_os = "macos")]
const NATIVE_ABOUT_MENU_ID: &str = "scratchpad-native-about";
#[cfg(target_os = "macos")]
const OPEN_ABOUT_EVENT: &str = "scratchpad-open-about";

#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppPreferences {
    last_workspace: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct WorkspacePreferenceError {
    kind: &'static str,
    message: String,
}

impl From<String> for WorkspacePreferenceError {
    fn from(message: String) -> Self {
        Self {
            kind: "settings-unreadable",
            message,
        }
    }
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
    let contents = serde_json::to_string_pretty(preferences)
        .map_err(|e| format!("Could not serialize native preferences: {e}"))?;
    file_export::export(path, &contents)
        .map_err(|e| format!("Could not write native preferences: {e}"))
}

fn load_workspace_preference_from(
    path: &Path,
    legacy_path: Option<String>,
    confirm_legacy: impl FnOnce(&Path) -> bool,
) -> Result<Option<String>, WorkspacePreferenceError> {
    if let Some(preferences) = read_preferences(path)? {
        return Ok(preferences.last_workspace);
    }

    // A webview preference is only a hint, never a native file grant. Ask once
    // before migrating it; ordinary native-preference restores need no prompt.
    let migrated_path = match legacy_path.filter(|value| !value.is_empty()) {
        Some(value) => {
            let candidate = PathBuf::from(value);
            let candidate = workspace::canonical_path(&candidate)
                .ok()
                .filter(|path| path.is_file());
            let Some(candidate) = candidate else {
                // Consume an unusable legacy hint once. If persistence fails,
                // return a settings error so the frontend retains its old key.
                write_preferences(
                    path,
                    &AppPreferences {
                        last_workspace: None,
                    },
                )?;
                return Err(WorkspacePreferenceError {
                    kind: "legacy-workspace-unavailable",
                    message:
                        "Previous workspace is unavailable. Open it again from the Scratchpad menu."
                            .into(),
                });
            };
            confirm_legacy(&candidate).then(|| candidate.to_string_lossy().into_owned())
        }
        None => None,
    };
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
    workspaces: tauri::State<'_, Workspaces>,
    legacy_path: Option<String>,
) -> Result<Option<String>, WorkspacePreferenceError> {
    if let Some(current) = workspaces.current_decision()? {
        return Ok(current.map(|path| path.to_string_lossy().into_owned()));
    }
    let saved = load_workspace_preference_from(&preferences_path(&app)?, legacy_path, |path| {
        rfd::MessageDialog::new()
            .set_title("Reopen previous workspace?")
            .set_description(format!("Scratchpad found this workspace in its previous settings:\n\n{}\n\nReopen it and remember this choice?", path.display()))
            .set_buttons(rfd::MessageButtons::YesNo)
            .show() == rfd::MessageDialogResult::Yes
    })?;
    restore_workspace_access(&workspaces, saved)
}

fn restore_workspace_access(
    workspaces: &Workspaces,
    saved: Option<String>,
) -> Result<Option<String>, WorkspacePreferenceError> {
    if let Some(current) = workspaces.current_decision()? {
        return Ok(current.map(|path| path.to_string_lossy().into_owned()));
    }
    let restored = saved
        .map(|path| workspaces.authorize(Path::new(&path), false))
        .transpose()
        .map_err(|message| {
            let _ = workspaces.set_current(None);
            WorkspacePreferenceError {
                kind: "workspace-unavailable",
                message,
            }
        })?;
    workspaces.set_current(restored.as_deref())?;
    Ok(restored.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn set_last_workspace(
    app: tauri::AppHandle,
    workspaces: tauri::State<'_, Workspaces>,
    db_path: Option<String>,
) -> Result<(), String> {
    remember_workspace(
        &preferences_path(&app)?,
        &workspaces,
        db_path.as_deref().map(Path::new),
    )
}

fn remember_workspace(
    preferences: &Path,
    workspaces: &Workspaces,
    db_path: Option<&Path>,
) -> Result<(), String> {
    let db_path = workspaces
        .set_current(db_path)?
        .map(|path| path.to_string_lossy().into_owned());
    write_preferences(
        preferences,
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

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashEntry {
    id: String,
    note: Note,
    deleted_at: i64,
    folder_name: Option<String>,
}

fn ensure_workspace_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY, entry TEXT NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;
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
fn save_file_native(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
    workspaces: tauri::State<'_, Workspaces>,
) -> Result<String, String> {
    save_text_file(
        &app,
        content,
        default_name,
        "Markdown",
        &["md"],
        &workspaces,
        TextExportKind::Note,
    )
}

#[tauri::command]
fn save_html_file_native(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
    workspaces: tauri::State<'_, Workspaces>,
) -> Result<String, String> {
    let path = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter("HTML", &["html"])
        .save_file()
        .ok_or("Cancelled")?;
    write_text_export(
        &path,
        &content,
        &backup::directory(&app)?,
        &workspaces,
        TextExportKind::Note,
    )?;
    Ok(path.to_string_lossy().into_owned())
}

enum TextExportKind {
    Note,
    Recovery,
}

fn write_text_export(
    path: &Path,
    content: &str,
    backup_directory: &Path,
    workspaces: &Workspaces,
    kind: TextExportKind,
) -> Result<(), String> {
    backup::ensure_export_destination(path, backup_directory, workspaces).map_err(|_| {
        "Choose an export file, not the open workspace or an active restore checkpoint"
    })?;
    match kind {
        TextExportKind::Note => file_export::export_note(path, content),
        TextExportKind::Recovery => file_export::export(path, content),
    }
}

#[tauri::command]
fn save_recovery_file_native(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
    workspaces: tauri::State<'_, Workspaces>,
) -> Result<String, String> {
    save_text_file(
        &app,
        content,
        default_name,
        "Recovery JSON",
        &["json"],
        &workspaces,
        TextExportKind::Recovery,
    )
}

#[tauri::command]
fn save_collection_backup(
    app: tauri::AppHandle,
    content: String,
    workspaces: tauri::State<'_, Workspaces>,
) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_file_name("scratchpad-collection-backup.json")
        .add_filter("Collection backup JSON", &["json"])
        .save_file();
    match path {
        Some(path) => {
            backup::export(&path, &content, &backup::directory(&app)?, &workspaces)?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn read_collection_backup() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .add_filter("Collection backup JSON", &["json"])
        .pick_file();
    path.map(|path| fs::read_to_string(path).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
fn preserve_collection_backup(app: tauri::AppHandle, content: String) -> Result<String, String> {
    backup::preserve(&backup::directory(&app)?, &content)
}

#[tauri::command]
fn begin_local_restore(
    app: tauri::AppHandle,
    values: serde_json::Value,
    content: String,
) -> Result<String, String> {
    backup::begin(&backup::directory(&app)?, values, &content)
}

#[tauri::command]
fn read_local_restore(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    backup::read(&backup::directory(&app)?)
}

#[tauri::command]
fn complete_local_restore(app: tauri::AppHandle) -> Result<(), String> {
    backup::complete(&backup::directory(&app)?)
}

#[tauri::command]
fn workspace_collection_initialized(
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
) -> Result<bool, String> {
    let conn = workspaces.open(&db_path)?;
    ensure_workspace_schema(&conn)?;
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='collection_metadata')", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if !exists {
        return Ok(false);
    }
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM collection_metadata WHERE key='initialized')",
        [],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

fn recovery_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("local-recovery"))
        .map_err(|error| format!("Could not resolve recovery directory: {error}"))
}

#[tauri::command]
fn archive_local_recovery(app: tauri::AppHandle, content: String) -> Result<String, String> {
    recovery::save_copy(&recovery_directory(&app)?, &content)
}

#[tauri::command]
fn has_local_recovery_copies(app: tauri::AppHandle) -> Result<bool, String> {
    recovery::has_copies(&recovery_directory(&app)?)
}

#[tauri::command]
fn read_local_recovery_copies(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    recovery::read_copies(&recovery_directory(&app)?)
}

fn save_text_file(
    app: &tauri::AppHandle,
    content: String,
    default_name: String,
    filter_name: &str,
    extensions: &[&str],
    workspaces: &Workspaces,
    kind: TextExportKind,
) -> Result<String, String> {
    let file_path = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter(filter_name, extensions)
        .save_file();

    if let Some(path) = file_path {
        write_text_export(&path, &content, &backup::directory(app)?, workspaces, kind)?;
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
fn select_db_file(workspaces: tauri::State<'_, Workspaces>) -> Result<Option<String>, String> {
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

    let (file_path, allow_create) = match choice {
        rfd::MessageDialogResult::Custom(action) if action == OPEN_EXISTING => (
            rfd::FileDialog::new()
                .set_title("Open Scratchpad Workspace")
                .add_filter("Scratchpad Workspace", &["db", "sqlite"])
                .pick_file(),
            false,
        ),
        rfd::MessageDialogResult::Custom(action) if action == CREATE_NEW => (
            rfd::FileDialog::new()
                .set_title("Create Scratchpad Workspace")
                .set_file_name("scratchpad.db")
                .add_filter("Scratchpad Workspace", &["db", "sqlite"])
                .save_file(),
            true,
        ),
        // These fallbacks preserve the intended behavior on any native backend
        // that reports standard results for custom-labeled buttons.
        rfd::MessageDialogResult::Yes => (
            rfd::FileDialog::new()
                .set_title("Open Scratchpad Workspace")
                .add_filter("Scratchpad Workspace", &["db", "sqlite"])
                .pick_file(),
            false,
        ),
        rfd::MessageDialogResult::No => (
            rfd::FileDialog::new()
                .set_title("Create Scratchpad Workspace")
                .set_file_name("scratchpad.db")
                .add_filter("Scratchpad Workspace", &["db", "sqlite"])
                .save_file(),
            true,
        ),
        _ => (None, false),
    };

    file_path
        .map(|path| {
            workspaces
                .authorize(&path, allow_create)
                .map(|path| path.to_string_lossy().into_owned())
        })
        .transpose()
}

#[tauri::command]
fn load_db_notes(
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
) -> Result<Vec<Note>, String> {
    let conn = workspaces.open(&db_path)?;
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
fn save_note_db(
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
    note: Note,
    sort_order: i64,
) -> Result<(), String> {
    let conn = workspaces.open(&db_path)?;
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
fn save_notes_db(
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
    notes: Vec<Note>,
) -> Result<(), String> {
    let mut conn = workspaces.open(&db_path)?;
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
fn load_db_folders(
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
) -> Result<Vec<Folder>, String> {
    let conn = workspaces.open(&db_path)?;
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
fn load_db_trash(
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
) -> Result<Vec<TrashEntry>, String> {
    let conn = workspaces.open(&db_path)?;
    ensure_workspace_schema(&conn)?;
    let mut stmt = conn
        .prepare("SELECT entry FROM trash ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    })
    .collect()
}

#[tauri::command]
fn save_folders_db(
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
    folders: Vec<Folder>,
) -> Result<(), String> {
    let mut conn = workspaces.open(&db_path)?;
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
    workspaces: tauri::State<'_, Workspaces>,
    db_path: String,
    notes: Vec<Note>,
    folders: Vec<Folder>,
    trash: Option<Vec<TrashEntry>>,
) -> Result<(), String> {
    // Validate the complete replacement before opening a transaction. A note
    // must never be committed pointing at a folder absent from this workspace.
    let folder_ids: std::collections::HashSet<&str> =
        folders.iter().map(|folder| folder.id.as_str()).collect();
    for note in &notes {
        if let Some(folder_id) = note.folder_id.as_deref() {
            if !folder_ids.contains(folder_id) {
                return Err(format!(
                    "Note {} references missing folder {}",
                    note.id, folder_id
                ));
            }
        }
    }
    let mut conn = workspaces.open(&db_path)?;
    ensure_workspace_schema(&conn)?;

    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute(
            "CREATE TABLE IF NOT EXISTS collection_metadata (key TEXT PRIMARY KEY)",
            [],
        )
        .map_err(|e| e.to_string())?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO collection_metadata (key) VALUES ('initialized')",
            [],
        )
        .map_err(|e| e.to_string())?;
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

    if let Some(entries) = trash {
        transaction
            .execute("DELETE FROM trash", [])
            .map_err(|e| e.to_string())?;
        let mut stmt = transaction
            .prepare("INSERT INTO trash (id, entry) VALUES (?1, ?2)")
            .map_err(|e| e.to_string())?;
        for entry in entries {
            let json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
            stmt.execute(rusqlite::params![entry.id, json])
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

#[cfg(target_os = "macos")]
fn macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let app_menu = menu
        .items()?
        .into_iter()
        .next()
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Tauri's default macOS application menu is missing",
            )
        })?;

    // Tauri's first application-menu item is a predefined About command that
    // opens the system metadata panel. The standard Quit action is guarded by
    // macos_quit's applicationShouldTerminate: hook, including Dock Quit.
    app_menu.remove_at(0)?.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Tauri's default macOS About menu item is missing",
        )
    })?;
    let about = MenuItem::with_id(
        app,
        NATIVE_ABOUT_MENU_ID,
        format!("About {}", app.package_info().name),
        true,
        None::<&str>,
    )?;
    app_menu.insert(&about, 0)?;

    Ok(menu)
}

#[cfg(target_os = "macos")]
fn handle_macos_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    if event.id() != NATIVE_ABOUT_MENU_ID {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Err(error) = window.emit(OPEN_ABOUT_EVENT, ()) {
            eprintln!("Could not open the Scratchpad About panel: {error}");
        }
    }
}

fn is_main_navigation_allowed(url: &tauri::Url) -> bool {
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    local
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(url.path(), "" | "/" | "/index.html")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(context: tauri::Context<tauri::Wry>) {
    let builder = tauri::Builder::default()
        .manage(mcp::McpState::default())
        .manage(note_print::PrintState::default())
        .manage(Workspaces::default())
        .on_window_event(|window, event| {
            // The frontend destroys main only after pending saves succeed.
            // A print preview must not keep an editor-less process alive;
            // CloseRequested is too early because saving can cancel a close.
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(macos_menu)
        .on_menu_event(handle_macos_menu_event)
        .setup(|app| {
            macos_quit::install(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        });

    builder
        // Markdown links have no default handling in the webview; the opener
        // plugin sends them to the user's browser instead. Its capability scope
        // limits it to the same schemes the Markdown sanitizer allows.
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|webview, url| {
                    if webview.label() == "main" {
                        is_main_navigation_allowed(url)
                    } else {
                        // The print window has its own, narrower page guard.
                        webview.label() == "note-print"
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            updates::get_update_info,
            updates::check_for_updates,
            updates::open_update_release,
            load_workspace_preference,
            set_last_workspace,
            save_file_native,
            save_html_file_native,
            note_print::open_note_print,
            note_print::get_print_note,
            note_print::print_note_native,
            note_print::close_note_print,
            save_recovery_file_native,
            save_collection_backup,
            read_collection_backup,
            preserve_collection_backup,
            begin_local_restore,
            read_local_restore,
            complete_local_restore,
            workspace_collection_initialized,
            archive_local_recovery,
            has_local_recovery_copies,
            read_local_recovery_copies,
            import_file_native,
            select_db_file,
            load_db_notes,
            load_db_folders,
            load_db_trash,
            save_note_db,
            save_notes_db,
            save_folders_db,
            save_workspace_db,
            show_alert_dialog,
            mcp::update_mcp_snapshot,
            mcp::update_mcp_note,
            mcp::get_mcp_connection_info,
            mcp::start_mcp_server,
            mcp::set_mcp_permissions,
            mcp::complete_mcp_write,
            mcp::stop_mcp_server
        ])
        .run(context)
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

    fn workspace_app(path: Option<&Path>) -> tauri::App<tauri::test::MockRuntime> {
        let workspaces = Workspaces::default();
        if let Some(path) = path {
            workspaces.authorize(path, true).unwrap();
        }
        tauri::test::mock_builder()
            .manage(workspaces)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
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
    fn every_database_operation_rejects_unchosen_paths_before_touching_a_file() {
        let path = temporary_db_path("unauthorized");
        let db_path = path.to_string_lossy().into_owned();
        let app = workspace_app(None);
        let workspaces = app.state::<Workspaces>();
        for existing in [false, true] {
            if existing {
                fs::write(&path, "do not modify this file").unwrap();
            }
            assert!(workspace_collection_initialized(workspaces.clone(), db_path.clone()).is_err());
            assert!(load_db_notes(workspaces.clone(), db_path.clone()).is_err());
            assert!(load_db_folders(workspaces.clone(), db_path.clone()).is_err());
            assert!(load_db_trash(workspaces.clone(), db_path.clone()).is_err());
            assert!(save_note_db(
                workspaces.clone(),
                db_path.clone(),
                note("one", "body", 1),
                0
            )
            .is_err());
            assert!(save_notes_db(workspaces.clone(), db_path.clone(), vec![]).is_err());
            assert!(save_folders_db(workspaces.clone(), db_path.clone(), vec![]).is_err());
            assert!(save_workspace_db(
                workspaces.clone(),
                db_path.clone(),
                vec![],
                vec![],
                Some(vec![])
            )
            .is_err());
            if existing {
                assert_eq!(
                    fs::read_to_string(&path).unwrap(),
                    "do not modify this file"
                );
            } else {
                assert!(!path.exists());
            }
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn main_navigation_stays_on_the_packaged_editor() {
        for url in [
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html#note",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/",
        ] {
            assert!(is_main_navigation_allowed(&url.parse().unwrap()), "{url}");
        }
        for url in [
            "https://example.com/",
            "https://tauri.localhost.example.com/index.html",
            "http://localhost/index.html",
            "http://127.0.0.1/index.html",
            "tauri://localhost/note-print.html",
            "tauri://localhost/main.js",
            "file:///index.html",
            "data:text/html,hello",
            "javascript:alert(1)",
            "about:blank",
            "tauri://user@localhost/index.html",
            "http://tauri.localhost:1234/index.html",
        ] {
            assert!(!is_main_navigation_allowed(&url.parse().unwrap()), "{url}");
        }
    }

    #[test]
    fn legacy_workspace_preferences_need_confirmation_and_cannot_create_files() {
        let preferences = temporary_db_path("legacy-declined").with_extension("json");
        let candidate = temporary_db_path("legacy-candidate");
        assert!(load_workspace_preference_from(
            &preferences,
            Some(candidate.to_string_lossy().into_owned()),
            |_| panic!("missing files must not be offered")
        )
        .is_err());
        assert!(!candidate.exists());
        assert!(read_preferences(&preferences)
            .unwrap()
            .unwrap()
            .last_workspace
            .is_none());
        assert!(load_workspace_preference_from(
            &preferences,
            Some(candidate.to_string_lossy().into_owned()),
            |_| panic!("invalid legacy paths must be consumed once")
        )
        .unwrap()
        .is_none());
        fs::remove_file(&preferences).unwrap();
        fs::write(&candidate, "unchanged").unwrap();
        let result = load_workspace_preference_from(
            &preferences,
            Some(candidate.to_string_lossy().into_owned()),
            |offered| {
                assert_eq!(offered, candidate.canonicalize().unwrap());
                false
            },
        )
        .unwrap();
        assert!(result.is_none());
        assert!(load_workspace_preference_from(
            &preferences,
            Some(candidate.to_string_lossy().into_owned()),
            |_| panic!("a declined migration must not prompt again")
        )
        .unwrap()
        .is_none());
        assert_eq!(fs::read_to_string(&candidate).unwrap(), "unchanged");
        fs::remove_file(preferences).unwrap();
        fs::remove_file(candidate).unwrap();
    }

    #[test]
    fn native_preferences_are_privately_replaced_and_shorter_rewrites_leave_valid_json() {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;

        let directory = crate::test_support::TestDirectory::new("private-preferences");
        let path = directory.join("preferences.json");
        write_preferences(
            &path,
            &AppPreferences {
                last_workspace: Some("a long workspace path to be replaced".into()),
            },
        )
        .unwrap();
        #[cfg(unix)]
        {
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            // Replace a read-only existing inode rather than opening it for
            // writing or requiring permission to chmod it.
            fs::hard_link(&path, directory.join("original.json")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        }
        write_preferences(&path, &AppPreferences::default()).unwrap();
        assert!(read_preferences(&path)
            .unwrap()
            .unwrap()
            .last_workspace
            .is_none());
        #[cfg(unix)]
        {
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            let original = directory.join("original.json");
            assert_eq!(
                fs::metadata(&original).unwrap().permissions().mode() & 0o777,
                0o400
            );
            assert_eq!(
                read_preferences(&original)
                    .unwrap()
                    .unwrap()
                    .last_workspace
                    .as_deref(),
                Some("a long workspace path to be replaced")
            );
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn failed_preference_publication_preserves_existing_data_and_cleans_staging() {
        let directory = crate::test_support::TestDirectory::new("failed-preferences");
        let path = directory.join("preferences.json");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("sentinel"), "existing data").unwrap();
        assert!(write_preferences(&path, &AppPreferences::default()).is_err());
        assert_eq!(
            fs::read_to_string(path.join("sentinel")).unwrap(),
            "existing data"
        );
        assert_eq!(fs::read_dir(&*directory).unwrap().count(), 1);
    }

    #[test]
    fn invalid_legacy_paths_are_consumed_only_after_preferences_are_saved() {
        let preferences = temporary_db_path("legacy-relative").with_extension("json");
        let result =
            load_workspace_preference_from(&preferences, Some("relative.db".into()), |_| {
                panic!("relative paths must not be offered")
            });
        assert_eq!(result.unwrap_err().kind, "legacy-workspace-unavailable");
        assert!(read_preferences(&preferences)
            .unwrap()
            .unwrap()
            .last_workspace
            .is_none());
        fs::remove_file(&preferences).unwrap();
        // A failed native preference write is a settings failure; JS keeps the
        // old migration key so a later launch can retry safely.
        fs::write(&preferences, "parent is a file").unwrap();
        let result = load_workspace_preference_from(
            &preferences.join("settings.json"),
            Some("relative.db".into()),
            |_| false,
        );
        assert_eq!(result.unwrap_err().kind, "settings-unreadable");
        fs::remove_file(preferences).unwrap();
    }

    #[test]
    fn missing_remembered_workspace_is_distinct_from_unreadable_preferences() {
        let path = temporary_db_path("missing-preference");
        let preferences = path.with_extension("json");
        write_preferences(
            &preferences,
            &AppPreferences {
                last_workspace: Some(path.to_string_lossy().into_owned()),
            },
        )
        .unwrap();
        let saved = load_workspace_preference_from(&preferences, None, |_| {
            panic!("native choices need no prompt")
        })
        .unwrap();
        let result = restore_workspace_access(&Workspaces::default(), saved);
        assert_eq!(result.unwrap_err().kind, "workspace-unavailable");
        assert!(!path.exists());
        assert!(
            read_preferences(&preferences)
                .unwrap()
                .unwrap()
                .last_workspace
                .is_some(),
            "keep the native preference for a temporarily absent volume"
        );
        fs::write(&preferences, "invalid JSON").unwrap();
        assert_eq!(
            load_workspace_preference_from(&preferences, None, |_| false)
                .unwrap_err()
                .kind,
            "settings-unreadable"
        );
        fs::remove_file(preferences).unwrap();
    }

    #[test]
    fn disconnect_revokes_access_even_when_preferences_cannot_be_written_or_reloaded() {
        let path = temporary_db_path("disconnect-failure");
        let workspaces = Workspaces::default();
        let path = workspaces.authorize(&path, true).unwrap();
        drop(workspaces.open(path.to_str().unwrap()).unwrap());
        workspaces.set_current(Some(&path)).unwrap();
        assert!(remember_workspace(&path.join("not-a-directory.json"), &workspaces, None).is_err());
        assert!(workspaces.open(path.to_str().unwrap()).is_err());
        assert!(
            restore_workspace_access(&workspaces, Some(path.to_string_lossy().into_owned()))
                .unwrap()
                .is_none()
        );
        assert!(workspaces.open(path.to_str().unwrap()).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn text_exports_write_utf8_and_refuse_workspace_and_restore_checkpoint_targets() {
        let directory =
            std::env::temp_dir().join(format!("scratchpad-html-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let workspace = directory.join("workspace.sqlite");
        let checkpoint = directory.join("pending-local-restore.json");
        let target = directory.join("note.html");
        std::fs::write(&workspace, "workspace sentinel").unwrap();
        std::fs::write(&checkpoint, "checkpoint sentinel").unwrap();
        let workspaces = Workspaces::default();
        workspaces.authorize(&workspace, false).unwrap();
        let html = "<!DOCTYPE html><title>Résumé 日本語</title><p>note</p>";
        write_text_export(&target, html, &directory, &workspaces, TextExportKind::Note).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), html);
        assert!(write_text_export(
            &workspace,
            html,
            &directory,
            &workspaces,
            TextExportKind::Note
        )
        .is_err());
        assert!(write_text_export(
            &checkpoint,
            html,
            &directory,
            &workspaces,
            TextExportKind::Recovery
        )
        .is_err());
        assert_eq!(
            std::fs::read_to_string(&workspace).unwrap(),
            "workspace sentinel"
        );
        assert_eq!(
            std::fs::read_to_string(&checkpoint).unwrap(),
            "checkpoint sentinel"
        );
        assert!(write_text_export(
            &directory.join("missing/note.html"),
            html,
            &directory,
            &workspaces,
            TextExportKind::Note
        )
        .is_err());
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn every_export_uses_native_workspace_protection_after_switch_and_disconnect() {
        let directory =
            std::env::temp_dir().join(format!("scratchpad-export-grants-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let a = directory.join("a.sqlite");
        let b = directory.join("b.sqlite");
        for path in [&a, &b] {
            fs::write(path, "workspace sentinel").unwrap();
        }
        let workspaces = Workspaces::default();
        workspaces.authorize(&a, false).unwrap();
        workspaces.set_current(Some(&a)).unwrap();
        workspaces.authorize(&b, false).unwrap();
        workspaces.set_current(Some(&b)).unwrap();
        let backup = r#"{"schemaVersion":1,"kind":"scratchpad-collection-backup","collection":{"notes":[],"folders":[],"trash":[]}}"#;
        for disconnected in [false, true] {
            if disconnected {
                workspaces.set_current(None).unwrap();
            }
            for path in [&a, &b] {
                for content in ["# Markdown export", "<!DOCTYPE html><p>HTML export</p>"] {
                    assert!(write_text_export(
                        path,
                        content,
                        &directory,
                        &workspaces,
                        TextExportKind::Note
                    )
                    .is_err());
                }
                assert!(write_text_export(
                    path,
                    "recovery JSON",
                    &directory,
                    &workspaces,
                    TextExportKind::Recovery
                )
                .is_err());
                assert!(backup::export(path, backup, &directory, &workspaces).is_err());
                assert_eq!(fs::read_to_string(path).unwrap(), "workspace sentinel");
            }
        }
        #[cfg(unix)]
        {
            let alias = directory.join("workspace-alias.html");
            std::os::unix::fs::symlink(&b, &alias).unwrap();
            assert!(write_text_export(
                &alias,
                "must not overwrite",
                &directory,
                &workspaces,
                TextExportKind::Note
            )
            .is_err());
        }
        let destination = directory.join("real-backup.json");
        backup::export(&destination, backup, &directory, &workspaces).unwrap();
        assert_eq!(fs::read_to_string(destination).unwrap(), backup);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn migrates_legacy_workspace_once_and_respects_an_explicit_disconnect() {
        let path = temporary_db_path("native-preferences").with_extension("json");
        let legacy_file = temporary_db_path("legacy-workspace");
        fs::write(&legacy_file, "").unwrap();
        let legacy_path = legacy_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();

        let migrated = load_workspace_preference_from(&path, Some(legacy_path.clone()), |_| true)
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
            |_| panic!("native preferences must take precedence"),
        )
        .expect("native preference should take precedence");
        assert_eq!(stale_legacy, None);

        std::fs::remove_file(path).expect("temporary preferences should be removable");
        fs::remove_file(legacy_file).unwrap();
    }

    #[test]
    fn saves_the_complete_workspace_in_sidebar_order() {
        let path = temporary_db_path("ordered-workspace");
        let app = workspace_app(Some(&path));
        let workspaces = app.state::<Workspaces>();
        let db_path = path.to_string_lossy().into_owned();

        save_notes_db(
            workspaces.clone(),
            db_path.clone(),
            vec![note("older", "left", 1), note("newer", "right", 2)],
        )
        .expect("workspace should save");

        save_note_db(
            workspaces.clone(),
            db_path.clone(),
            note("newer", "edited in secondary pane", 3),
            1,
        )
        .expect("secondary note should save independently");

        let loaded =
            load_db_notes(workspaces.clone(), db_path.clone()).expect("workspace should load");
        assert_eq!(loaded[0].id, "older");
        assert_eq!(loaded[1].content, "edited in secondary pane");

        let mut pinned_note = loaded[1].clone();
        pinned_note.is_pinned = true;
        let reordered = vec![pinned_note, loaded[0].clone()];
        save_notes_db(workspaces.clone(), db_path.clone(), reordered.clone())
            .expect("workspace should resave");

        let loaded = load_db_notes(workspaces.clone(), db_path).expect("workspace should load");
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
        let app = workspace_app(Some(&path));
        let workspaces = app.state::<Workspaces>();
        let db_path = path.to_string_lossy().into_owned();
        let folders = vec![folder("work", "Work"), folder("personal", "Personal")];
        save_folders_db(workspaces.clone(), db_path.clone(), folders).expect("folders should save");

        let mut assigned = note("assigned", "in work", 1);
        assigned.folder_id = Some("work".to_string());
        save_notes_db(workspaces.clone(), db_path.clone(), vec![assigned])
            .expect("assigned note should save");

        let loaded_folders =
            load_db_folders(workspaces.clone(), db_path.clone()).expect("folders should load");
        let loaded_notes =
            load_db_notes(workspaces.clone(), db_path.clone()).expect("notes should load");
        assert_eq!(loaded_folders[0].id, "work");
        assert_eq!(loaded_folders[1].name, "Personal");
        assert_eq!(loaded_notes[0].folder_id.as_deref(), Some("work"));

        std::fs::remove_file(path).expect("temporary database should be removable");
    }

    #[test]
    fn trash_deletion_and_restore_are_atomic_and_survive_other_saves() {
        let path = temporary_db_path("trash-workspace");
        let app = workspace_app(Some(&path));
        let workspaces = app.state::<Workspaces>();
        let db_path = path.to_string_lossy().into_owned();
        let original = note("original", "recover the full body", 1);
        let entry = TrashEntry {
            id: "trash-one".into(),
            note: original.clone(),
            deleted_at: 2,
            folder_name: None,
        };
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![original.clone()],
            vec![],
            Some(vec![]),
        )
        .unwrap();
        // A duplicate recovery ID fails after the active rows have been replaced;
        // the entire transaction must roll back, retaining the live note.
        assert!(save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![],
            vec![],
            Some(vec![entry.clone(), entry.clone()])
        )
        .is_err());
        assert_eq!(
            load_db_notes(workspaces.clone(), db_path.clone()).unwrap()[0].content,
            original.content
        );
        assert!(load_db_trash(workspaces.clone(), db_path.clone())
            .unwrap()
            .is_empty());
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![],
            vec![],
            Some(vec![entry.clone()]),
        )
        .unwrap();
        assert!(load_db_notes(workspaces.clone(), db_path.clone())
            .unwrap()
            .is_empty());
        assert_eq!(
            load_db_trash(workspaces.clone(), db_path.clone()).unwrap()[0]
                .note
                .content,
            original.content
        );
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![note("other", "typed", 3)],
            vec![],
            None,
        )
        .unwrap();
        assert_eq!(
            load_db_trash(workspaces.clone(), db_path.clone())
                .unwrap()
                .len(),
            1
        );
        // An invalid restored folder cannot remove the recovery entry.
        let mut invalid = original.clone();
        invalid.folder_id = Some("missing".into());
        assert!(save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![invalid],
            vec![],
            Some(vec![])
        )
        .is_err());
        assert_eq!(
            load_db_trash(workspaces.clone(), db_path.clone())
                .unwrap()
                .len(),
            1
        );
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![original.clone()],
            vec![],
            Some(vec![]),
        )
        .unwrap();
        assert_eq!(
            load_db_notes(workspaces.clone(), db_path.clone()).unwrap()[0].id,
            original.id
        );
        assert!(load_db_trash(workspaces.clone(), db_path.clone())
            .unwrap()
            .is_empty());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn collection_backup_round_trip_includes_order_pins_trash_and_initialized_empty_workspaces() {
        let path = temporary_db_path("backup-round-trip");
        let app = workspace_app(Some(&path));
        let workspaces = app.state::<Workspaces>();
        let db_path = path.to_string_lossy().into_owned();
        assert!(!workspace_collection_initialized(workspaces.clone(), db_path.clone()).unwrap());
        let mut pinned = note("pinned", "Unicode 🐈", 5);
        pinned.is_pinned = true;
        pinned.folder_id = Some("f".into());
        let notes = vec![pinned, note("second", "Body", 6)];
        let folders = vec![folder("empty", "Empty"), folder("f", "Folder")];
        let mut deleted = note("gone", "Deleted body", 3);
        deleted.folder_id = Some("removed".into());
        let trash = vec![TrashEntry {
            id: "t".into(),
            note: deleted,
            deleted_at: 4,
            folder_name: Some("Removed".into()),
        }];
        let expected = serde_json::json!({ "notes": notes, "folders": folders, "trash": trash });
        let serialized =
            serde_json::json!({ "kind": "scratchpad-collection-backup", "schemaVersion": 1,
            "createdAt": "2026-10-01T00:00:00Z", "collection": expected })
            .to_string();
        let parsed: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            serde_json::from_value(parsed["collection"]["notes"].clone()).unwrap(),
            serde_json::from_value(parsed["collection"]["folders"].clone()).unwrap(),
            Some(serde_json::from_value(parsed["collection"]["trash"].clone()).unwrap()),
        )
        .unwrap();
        assert_eq!(
            serde_json::json!({ "notes": load_db_notes(workspaces.clone(), db_path.clone()).unwrap(),
            "folders": load_db_folders(workspaces.clone(), db_path.clone()).unwrap(), "trash": load_db_trash(workspaces.clone(), db_path.clone()).unwrap() }),
            expected
        );
        assert!(workspace_collection_initialized(workspaces.clone(), db_path.clone()).unwrap());
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![],
            vec![],
            Some(trash),
        )
        .unwrap();
        assert!(load_db_notes(workspaces.clone(), db_path.clone())
            .unwrap()
            .is_empty());
        assert_eq!(
            load_db_trash(workspaces.clone(), db_path.clone())
                .unwrap()
                .len(),
            1
        );
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![],
            vec![],
            Some(vec![]),
        )
        .unwrap();
        assert!(workspace_collection_initialized(workspaces.clone(), db_path.clone()).unwrap());
        assert!(load_db_notes(workspaces.clone(), db_path.clone())
            .unwrap()
            .is_empty());
        assert!(load_db_folders(workspaces.clone(), db_path.clone())
            .unwrap()
            .is_empty());
        assert!(load_db_trash(workspaces.clone(), db_path)
            .unwrap()
            .is_empty());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn workspace_structure_save_is_atomic() {
        let path = temporary_db_path("atomic-workspace");
        let app = workspace_app(Some(&path));
        let workspaces = app.state::<Workspaces>();
        let db_path = path.to_string_lossy().into_owned();
        let mut original_note = note("original", "keep me", 1);
        original_note.folder_id = Some("original-folder".to_string());
        save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![original_note],
            vec![folder("original-folder", "Original")],
            None,
        )
        .expect("initial workspace should save");

        let failed = save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![note("replacement", "must roll back", 2)],
            vec![folder("duplicate", "One"), folder("duplicate", "Two")],
            None,
        );
        assert!(failed.is_err());

        let mut orphan = note("orphan", "must not save", 3);
        orphan.folder_id = Some("missing".into());
        assert!(save_workspace_db(
            workspaces.clone(),
            db_path.clone(),
            vec![orphan],
            vec![],
            None
        )
        .is_err());

        let loaded_notes = load_db_notes(workspaces.clone(), db_path.clone())
            .expect("original notes should remain");
        let loaded_folders = load_db_folders(workspaces.clone(), db_path.clone())
            .expect("original folders should remain");
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
        let app = workspace_app(Some(&path));
        let workspaces = app.state::<Workspaces>();
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

        let loaded =
            load_db_notes(workspaces.clone(), db_path).expect("legacy schema should migrate");
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
