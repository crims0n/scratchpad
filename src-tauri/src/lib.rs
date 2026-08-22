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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn save_file_native(content: String, default_name: String) -> Result<String, String> {
    let file_path = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .save_file();

    if let Some(path) = file_path {
        let mut file = File::create(&path).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
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
                    .set_description(&format!(
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
    let ask_create = rfd::MessageDialog::new()
        .set_title("Database Workspace")
        .set_description("Do you want to CREATE a new SQLite database file?\n\nClick 'Yes' to create a new database, or 'No' to select an existing database.")
        .set_buttons(rfd::MessageButtons::YesNo)
        .show();

    let dialog = rfd::FileDialog::new().add_filter("SQLite Database", &["db", "sqlite"]);
    let file_path = if ask_create == rfd::MessageDialogResult::Yes {
        dialog.save_file()
    } else {
        dialog.pick_file()
    };
    Ok(file_path.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn load_db_notes(db_path: String) -> Result<Vec<Note>, String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            updatedAt INTEGER NOT NULL,
            isTitleLocked INTEGER NOT NULL
        )",
        [],
    ).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, content, updatedAt, isTitleLocked FROM notes ORDER BY updatedAt DESC")
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
fn save_note_db(db_path: String, note: Note) -> Result<(), String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            updatedAt INTEGER NOT NULL,
            isTitleLocked INTEGER NOT NULL
        )",
        [],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO notes (id, title, content, updatedAt, isTitleLocked) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            note.id,
            note.title,
            note.content,
            note.updated_at,
            if note.is_title_locked { 1 } else { 0 }
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_note_db(db_path: String, id: String) -> Result<(), String> {
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet, 
            save_file_native, 
            import_file_native,
            select_db_file,
            load_db_notes,
            save_note_db,
            delete_note_db
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
