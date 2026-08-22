use std::fs::File;
use std::io::Write;

// Note struct representation matching frontend note
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    title: String,
    content: String,
    updated_at: i64,
    is_title_locked: bool,
}

fn ensure_notes_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            updatedAt INTEGER NOT NULL,
            isTitleLocked INTEGER NOT NULL,
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
    ensure_notes_table(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, updatedAt, isTitleLocked
             FROM notes
             ORDER BY sortOrder ASC, updatedAt DESC",
        )
        .map_err(|e| e.to_string())?;

    let note_iter = stmt
        .query_map([], |row| {
            let is_title_locked_int: i32 = row.get(4)?;
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                updated_at: row.get(3)?,
                is_title_locked: is_title_locked_int != 0,
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
    ensure_notes_table(&conn)?;

    conn.execute(
        "INSERT INTO notes (
            id, title, content, updatedAt, isTitleLocked, sortOrder
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            updatedAt = excluded.updatedAt,
            isTitleLocked = excluded.isTitleLocked,
            sortOrder = excluded.sortOrder",
        rusqlite::params![
            note.id,
            note.title,
            note.content,
            note.updated_at,
            if note.is_title_locked { 1 } else { 0 },
            sort_order,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn save_notes_db(db_path: String, notes: Vec<Note>) -> Result<(), String> {
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_notes_table(&conn)?;

    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM notes", [])
        .map_err(|e| e.to_string())?;

    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO notes (
                    id, title, content, updatedAt, isTitleLocked, sortOrder
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_file_native,
            import_file_native,
            select_db_file,
            load_db_notes,
            save_note_db,
            save_notes_db,
            show_alert_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
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
        }
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

        let reordered = vec![loaded[1].clone(), loaded[0].clone()];
        save_notes_db(db_path.clone(), reordered.clone()).expect("workspace should resave");

        let loaded = load_db_notes(db_path).expect("workspace should load");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "newer");
        assert_eq!(loaded[0].content, "edited in secondary pane");
        assert_eq!(loaded[1].id, "older");

        std::fs::remove_file(path).expect("temporary database should be removable");
    }

    #[test]
    fn migrates_existing_databases_without_a_sort_order_column() {
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
        drop(connection);

        std::fs::remove_file(path).expect("temporary database should be removable");
    }
}
