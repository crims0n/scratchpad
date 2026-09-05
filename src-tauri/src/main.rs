// SPDX-License-Identifier: GPL-3.0-or-later

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Dispatch before Tauri creates a webview or touches editor persistence.
    // The MCP host supplies stdin/stdout pipes, including for the Windows GUI
    // subsystem build; diagnostics must only go to stderr in this mode.
    if std::env::args_os().any(|argument| argument == "--mcp-stdio") {
        if std::env::args_os().count() != 2 {
            eprintln!("Usage: scratchpad --mcp-stdio");
            std::process::exit(2);
        }
        if let Err(error) = scratchpad_lib::run_mcp_stdio() {
            eprintln!("Scratchpad MCP: {error}");
            std::process::exit(1);
        }
        return;
    }
    scratchpad_lib::run()
}
