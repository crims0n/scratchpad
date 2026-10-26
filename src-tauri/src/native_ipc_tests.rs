// SPDX-License-Identifier: GPL-3.0-or-later

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

#[test]
fn compiled_permission_groups_keep_print_access_separate() {
    let manifests: serde_json::Value =
        serde_json::from_str(include_str!("../gen/schemas/acl-manifests.json")).unwrap();
    let permissions = &manifests["__app-acl__"]["permissions"];
    let print = permissions["note-print-commands"]["commands"]["allow"]
        .as_array()
        .unwrap();
    let editor = permissions["editor-commands"]["commands"]["allow"]
        .as_array()
        .unwrap();
    let mut names = print
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect::<Vec<_>>();
    names.sort_unstable();
    assert_eq!(
        names,
        ["close_note_print", "get_print_note", "print_note_native"]
    );
    assert!(editor.len() > 20);
    assert!(print.iter().all(|command| !editor.contains(command)));
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
    let path = std::env::temp_dir().join(format!("scratchpad-ipc-{}.sqlite", uuid::Uuid::new_v4()));
    let workspaces = Workspaces::default();
    let path = workspaces.authorize(&path, true).unwrap();
    let app = mock_builder()
        .manage(workspaces)
        .manage(crate::note_print::PrintState::default())
        .invoke_handler(tauri::generate_handler![
            complete_native_quit,
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
    let quit = serde_json::json!({ "requestId": "not-a-pending-request", "saved": true });
    assert_eq!(
        invoke(&main, "complete_native_quit", local, quit.clone()).unwrap(),
        false
    );
    assert!(invoke(
        &main,
        "complete_native_quit",
        "https://example.com/",
        quit.clone()
    )
    .is_err());
    assert!(invoke(
        &print,
        "complete_native_quit",
        "tauri://localhost/note-print.html",
        quit
    )
    .is_err());
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
    let workspaces = app.state::<Workspaces>();
    workspaces.set_current(Some(&path)).unwrap();
    workspaces.set_current(None).unwrap();
    assert!(invoke(
        &main,
        "load_db_notes",
        local,
        serde_json::json!({ "dbPath": path })
    )
    .is_err());
    std::fs::remove_file(path).unwrap();
}
