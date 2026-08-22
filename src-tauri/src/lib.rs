use std::fs::File;
use std::io::Write;

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
    let file_path = rfd::FileDialog::new()
        .add_filter("Text Files", &["md", "txt", "markdown"])
        .pick_file();

    if let Some(path) = file_path {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Imported Note")
            .to_string();
        
        let title = if let Some(idx) = name.rfind('.') {
            name[..idx].to_string()
        } else {
            name
        };

        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        Ok(Some(ImportedFile { title, content }))
    } else {
        Ok(None)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet, save_file_native, import_file_native])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
