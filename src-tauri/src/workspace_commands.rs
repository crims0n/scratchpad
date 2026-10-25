// SPDX-License-Identifier: GPL-3.0-or-later

use crate::{workspace::Workspaces, Folder, Note, TrashEntry};
use tauri::State;

#[tauri::command]
pub(crate) fn workspace_collection_initialized(
    workspaces: State<'_, Workspaces>,
    db_path: String,
) -> Result<bool, String> {
    crate::workspace_collection_initialized(&workspaces, db_path)
}

#[tauri::command]
pub(crate) fn load_db_notes(
    workspaces: State<'_, Workspaces>,
    db_path: String,
) -> Result<Vec<Note>, String> {
    crate::load_db_notes(&workspaces, db_path)
}

#[tauri::command]
pub(crate) fn load_db_folders(
    workspaces: State<'_, Workspaces>,
    db_path: String,
) -> Result<Vec<Folder>, String> {
    crate::load_db_folders(&workspaces, db_path)
}

#[tauri::command]
pub(crate) fn load_db_trash(
    workspaces: State<'_, Workspaces>,
    db_path: String,
) -> Result<Vec<TrashEntry>, String> {
    crate::load_db_trash(&workspaces, db_path)
}

#[tauri::command]
pub(crate) fn save_note_db(
    workspaces: State<'_, Workspaces>,
    db_path: String,
    note: Note,
    sort_order: i64,
) -> Result<(), String> {
    crate::save_note_db(&workspaces, db_path, note, sort_order)
}

#[tauri::command]
pub(crate) fn save_notes_db(
    workspaces: State<'_, Workspaces>,
    db_path: String,
    notes: Vec<Note>,
) -> Result<(), String> {
    crate::save_notes_db(&workspaces, db_path, notes)
}

#[tauri::command]
pub(crate) fn save_folders_db(
    workspaces: State<'_, Workspaces>,
    db_path: String,
    folders: Vec<Folder>,
) -> Result<(), String> {
    crate::save_folders_db(&workspaces, db_path, folders)
}

#[tauri::command]
pub(crate) fn save_workspace_db(
    workspaces: State<'_, Workspaces>,
    db_path: String,
    notes: Vec<Note>,
    folders: Vec<Folder>,
    trash: Option<Vec<TrashEntry>>,
) -> Result<(), String> {
    crate::save_workspace_db(&workspaces, db_path, notes, folders, trash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{
        test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY},
        webview::InvokeRequest,
        WebviewWindow, WebviewWindowBuilder,
    };

    #[tauri::command]
    fn undeclared_command() -> &'static str {
        "must never be returned"
    }

    fn invoke(
        window: &WebviewWindow<MockRuntime>,
        command: &str,
        url: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, serde_json::Value> {
        get_ipc_response(
            window,
            InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: url.parse().unwrap(),
                body: body.into(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map(|value| value.deserialize().unwrap())
    }

    #[test]
    fn built_capabilities_enforce_window_and_origin_boundaries_over_ipc() {
        let path =
            std::env::temp_dir().join(format!("scratchpad-ipc-{}.sqlite", uuid::Uuid::new_v4()));
        let workspaces = Workspaces::default();
        let path = workspaces.authorize(&path, true).unwrap();
        let app = mock_builder()
            .manage(workspaces)
            .manage(crate::note_print::PrintState::default())
            .invoke_handler(tauri::generate_handler![
                load_db_notes,
                crate::note_print::get_print_note,
                crate::note_print::close_note_print,
                undeclared_command
            ])
            .build(tauri::generate_context!())
            .unwrap();
        let main = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let print = WebviewWindowBuilder::new(
            &app,
            "note-print",
            tauri::WebviewUrl::App("note-print.html".into()),
        )
        .build()
        .unwrap();
        let local = "tauri://localhost/index.html";
        let body = serde_json::json!({ "dbPath": path });
        // A remote origin and the print window cannot open even a granted DB.
        assert!(invoke(&main, "load_db_notes", "https://example.com/", body.clone()).is_err());
        assert!(invoke(
            &print,
            "load_db_notes",
            "tauri://localhost/note-print.html",
            body.clone()
        )
        .is_err());
        assert!(!path.exists());
        assert_eq!(
            invoke(&main, "load_db_notes", local, body).unwrap(),
            serde_json::json!([])
        );
        // Registered commands omitted from the manifest fail closed.
        assert!(invoke(&main, "undeclared_command", local, serde_json::json!({})).is_err());
        assert!(invoke(&main, "get_print_note", local, serde_json::json!({})).is_err());
        assert!(invoke(&main, "close_note_print", local, serde_json::json!({})).is_err());
        assert!(invoke(
            &print,
            "plugin:window|close",
            "tauri://localhost/note-print.html",
            serde_json::json!({ "label": "main" })
        )
        .is_err());
        assert_eq!(
            invoke(
                &print,
                "get_print_note",
                "tauri://localhost/note-print.html",
                serde_json::json!({})
            )
            .unwrap_err(),
            "No note has been prepared for printing"
        );
        let unchosen = path.with_extension("unchosen.sqlite");
        assert!(invoke(
            &main,
            "load_db_notes",
            local,
            serde_json::json!({ "dbPath": unchosen })
        )
        .is_err());
        assert!(!unchosen.exists());
        std::fs::remove_file(path).unwrap();
    }
}
