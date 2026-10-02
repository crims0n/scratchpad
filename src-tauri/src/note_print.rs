// SPDX-License-Identifier: GPL-3.0-or-later

use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const PRINT_WINDOW: &str = "note-print";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintNote {
    title: String,
    content: String,
    syntax_highlighting: bool,
}

// A single immutable snapshot, kept only in memory until the print window is
// destroyed. No note, workspace, backup, or temporary file is written.
#[derive(Default)]
pub struct PrintState(Mutex<Option<PrintNote>>);

fn require_window(actual: &str, expected: &str) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err("This print command is not available in this window".into())
    }
}

fn is_print_navigation_allowed(url: &tauri::Url) -> bool {
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    local && url.path() == "/note-print.html"
}

#[tauri::command]
pub async fn open_note_print(
    app: AppHandle,
    window: WebviewWindow,
    title: String,
    content: String,
    syntax_highlighting: bool,
) -> Result<(), String> {
    require_window(window.label(), "main")?;
    {
        let state = app.state::<PrintState>();
        let mut snapshot = state.0.lock().map_err(|error| error.to_string())?;
        if snapshot.is_some() {
            if let Some(existing) = app.get_webview_window(PRINT_WINDOW) {
                let _ = existing.set_focus();
            }
            return Err("Close the existing print window before preparing another note".into());
        }
        *snapshot = Some(PrintNote {
            title,
            content,
            syntax_highlighting,
        });
    }
    let print_window = WebviewWindowBuilder::new(
        &app,
        PRINT_WINDOW,
        WebviewUrl::App("note-print.html".into()),
    )
    .title("Print Note — Scratchpad")
    .inner_size(800.0, 700.0)
    // The preview is not a browser: note links must never navigate it away
    // from the packaged page or grant an external origin native commands.
    .on_navigation(is_print_navigation_allowed)
    .build();
    match print_window {
        Ok(window) => {
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Destroyed) {
                    if let Ok(mut snapshot) = app.state::<PrintState>().0.lock() {
                        *snapshot = None;
                    }
                }
            });
            Ok(())
        }
        Err(error) => {
            *app.state::<PrintState>()
                .0
                .lock()
                .map_err(|error| error.to_string())? = None;
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub fn get_print_note(app: AppHandle, window: WebviewWindow) -> Result<PrintNote, String> {
    require_window(window.label(), PRINT_WINDOW)?;
    app.state::<PrintState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "No note has been prepared for printing".into())
}

#[tauri::command]
pub fn print_note_native(window: WebviewWindow) -> Result<(), String> {
    require_window(window.label(), PRINT_WINDOW)?;
    // The locked Wry version uses AppKit on macOS, WebKit PrintOperation on
    // Linux, and window.print() in WebView2 on Windows. This is the note-only
    // top-level webview, not the editor or an embedded frame.
    window.print().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_commands_are_restricted_to_their_own_windows() {
        assert!(require_window("main", "main").is_ok());
        assert!(require_window(PRINT_WINDOW, PRINT_WINDOW).is_ok());
        assert!(require_window("main", PRINT_WINDOW).is_err());
        assert!(require_window(PRINT_WINDOW, "main").is_err());
        assert!(require_window("external", PRINT_WINDOW).is_err());
    }

    #[test]
    fn print_preview_navigation_stays_on_its_packaged_page() {
        for url in [
            "tauri://localhost/note-print.html",
            "http://tauri.localhost/note-print.html",
            "https://tauri.localhost/note-print.html#heading",
        ] {
            assert!(is_print_navigation_allowed(&url.parse().unwrap()));
        }
        for url in [
            "https://example.com/note-print.html",
            "https://tauri.localhost.example.com/note-print.html",
            "http://localhost/note-print.html",
            "file:///note-print.html",
            "tauri://localhost/index.html",
            "https://tauri.localhost/",
        ] {
            assert!(!is_print_navigation_allowed(&url.parse().unwrap()));
        }
    }

    #[test]
    fn print_snapshot_retains_markdown_as_data_and_serializes_the_highlighting_preference() {
        let note = PrintNote {
            title: "Résumé <notes>".into(),
            content: "# Note\n\n<script>untrusted</script>".into(),
            syntax_highlighting: false,
        };
        let value = serde_json::to_value(note).unwrap();
        assert_eq!(value["title"], "Résumé <notes>");
        assert_eq!(value["content"], "# Note\n\n<script>untrusted</script>");
        assert_eq!(value["syntaxHighlighting"], false);
    }
}
