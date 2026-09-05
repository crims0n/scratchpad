// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, ClientJsonRpcMessage, ClientRequest, ContentBlock, EmptyResult, GetMeta,
    Implementation, ProtocolVersion, ServerCapabilities, ServerInfo, ServerJsonRpcMessage,
    ServerResult, SubscriptionFilter,
};
use rmcp::transport::{async_rw::AsyncRwTransport, Transport};
use rmcp::{
    tool, tool_handler, tool_router, ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
};
use serde::Serialize;
use subtle::ConstantTimeEq;
use tauri::Manager;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{Folder, Note};

const MCP_PORT: u16 = 39_393;
const MCP_TOKEN_FILE_NAME: &str = "scratchpad-mcp-token";
const CONNECTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const DEFAULT_PAGE_SIZE: u32 = 50;
const MAX_PAGE_SIZE: u32 = 200;
const PREVIEW_CHARS: usize = 240;
const DEFAULT_CONTENT_CHARS: u32 = 20_000;
const MAX_CONTENT_CHARS: u32 = 100_000;

#[derive(Debug)]
struct Snapshot {
    collection_name: String,
    notes: Vec<Note>,
    folders: Vec<Folder>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            collection_name: "Local notes".into(),
            notes: Vec::new(),
            folders: Vec::new(),
        }
    }
}

type SharedSnapshot = Arc<RwLock<Snapshot>>;

struct RunningServer {
    cancellation: CancellationToken,
    task: JoinHandle<()>,
    connection: McpConnectionInfo,
}

pub(crate) struct McpState {
    snapshot: SharedSnapshot,
    running: tokio::sync::Mutex<Option<RunningServer>>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            snapshot: Arc::new(RwLock::new(Snapshot::default())),
            running: tokio::sync::Mutex::new(None),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpConnectionInfo {
    command: String,
    args: Vec<String>,
    mode: &'static str,
}

#[tauri::command]
pub(crate) fn update_mcp_snapshot(
    state: tauri::State<'_, McpState>,
    collection_name: String,
    notes: Vec<Note>,
    folders: Vec<Folder>,
) -> Result<(), String> {
    let collection_name = collection_name.trim();
    if collection_name.is_empty() {
        return Err("The MCP collection name cannot be empty".into());
    }

    let mut snapshot = state
        .snapshot
        .write()
        .map_err(|_| "The MCP note snapshot is unavailable".to_string())?;
    *snapshot = Snapshot {
        collection_name: collection_name.chars().take(200).collect(),
        notes,
        folders,
    };
    Ok(())
}

#[tauri::command]
pub(crate) fn update_mcp_note(state: tauri::State<'_, McpState>, note: Note) -> Result<(), String> {
    let mut snapshot = state
        .snapshot
        .write()
        .map_err(|_| "The MCP note snapshot is unavailable".to_string())?;
    let existing = snapshot
        .notes
        .iter_mut()
        .find(|existing| existing.id == note.id)
        .ok_or_else(|| format!("The MCP snapshot has no note with id `{}`", note.id))?;
    *existing = note;
    Ok(())
}

#[tauri::command]
pub(crate) async fn start_mcp_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
) -> Result<McpConnectionInfo, String> {
    let mut running = state.running.lock().await;
    if let Some(server) = running.as_ref() {
        return Ok(server.connection.clone());
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the Scratchpad executable: {error}"))?;
    // An AppImage's inner binary lives in a temporary mount. Its outer path
    // remains launchable after the editor exits and the mount is removed.
    #[cfg(target_os = "linux")]
    let executable = std::env::var_os("APPIMAGE")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file())
        .unwrap_or(executable);
    let command = executable
        .into_os_string()
        .into_string()
        .map_err(|_| "The Scratchpad executable path is not valid Unicode".to_string())?;
    let listener = TcpListener::bind(("127.0.0.1", MCP_PORT))
        .await
        .map_err(|error| {
            format!(
                "Could not enable agent access on port {MCP_PORT}. Another application may be using it: {error}"
            )
        })?;
    let token_path = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve the app configuration directory: {error}"))?
        .join(MCP_TOKEN_FILE_NAME);
    let token = load_or_create_token(&token_path)?;
    let cancellation = CancellationToken::new();
    let task = tokio::spawn(serve_local_connections(
        listener,
        state.snapshot.clone(),
        token,
        cancellation.clone(),
    ));
    let connection = McpConnectionInfo {
        command,
        args: vec!["--mcp-stdio".into()],
        mode: "readOnly",
    };
    *running = Some(RunningServer {
        cancellation,
        task,
        connection: connection.clone(),
    });
    Ok(connection)
}

#[tauri::command]
pub(crate) async fn stop_mcp_server(state: tauri::State<'_, McpState>) -> Result<(), String> {
    let server = state.running.lock().await.take();
    if let Some(server) = server {
        server.cancellation.cancel();
        let mut task = server.task;
        if tokio::time::timeout(std::time::Duration::from_secs(2), &mut task)
            .await
            .is_err()
        {
            task.abort();
            let _ = task.await;
        }
    }
    Ok(())
}

// The editor owns the live snapshot. Each headless invocation relays its stdio
// stream over this authenticated loopback channel, without reading note files
// or launching another editor. The token never enters client configuration.
async fn serve_local_connections(
    listener: TcpListener,
    snapshot: SharedSnapshot,
    token: String,
    cancellation: CancellationToken,
) {
    let mut sessions = JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            _ = sessions.join_next(), if !sessions.is_empty() => {},
            connection = listener.accept(), if sessions.len() < 32 => {
                let Ok((mut stream, _)) = connection else { break };
                let snapshot = snapshot.clone();
                let token = token.clone();
                let session_cancellation = cancellation.child_token();
                sessions.spawn(async move {
                    let authenticate = tokio::time::timeout(CONNECTION_TIMEOUT, async {
                        let mut supplied = [0u8; 65];
                        stream.read_exact(&mut supplied).await?;
                        if supplied[64] != b'\n'
                            || !bool::from(supplied[..64].ct_eq(token.as_bytes()))
                        {
                            return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
                        }
                        stream.write_all(&[1]).await
                    });
                    let authenticated = tokio::select! {
                        result = authenticate => result,
                        _ = session_cancellation.cancelled() => return,
                    };
                    if !matches!(authenticated, Ok(Ok(()))) { return; }
                    serve_mcp_connection(stream, snapshot, session_cancellation).await;
                });
            }
        }
    }
    // Waiting for every session ensures disabling access closes all sockets
    // before another enable can start accepting connections.
    cancellation.cancel();
    while sessions.join_next().await.is_some() {}
}

async fn serve_mcp_connection(stream: TcpStream, snapshot: SharedSnapshot, ct: CancellationToken) {
    let (reader, writer) = stream.into_split();
    let mut transport = AsyncRwTransport::new_server(BoundedMessageReader::new(reader), writer);
    let first = loop {
        let message = tokio::select! {
            message = transport.receive() => message,
            _ = ct.cancelled() => return,
        };
        let Some(message) = message else { return };
        // Legacy clients may ping before initialize. Answer these without
        // committing to either the legacy or per-request metadata lifecycle.
        if let ClientJsonRpcMessage::Request(request) = &message {
            if matches!(request.request, ClientRequest::PingRequest(_)) {
                if transport
                    .send(ServerJsonRpcMessage::response(
                        ServerResult::EmptyResult(EmptyResult {}),
                        request.id.clone(),
                    ))
                    .await
                    .is_err()
                {
                    return;
                }
                continue;
            }
        }
        break message;
    };
    let legacy = matches!(&first, ClientJsonRpcMessage::Request(request)
        if matches!(request.request, ClientRequest::InitializeRequest(_)));
    let transport = PrefetchedTransport {
        first: Some(first),
        inner: transport,
        require_metadata: !legacy,
    };
    let server = ScratchpadServer::new(snapshot);
    let service = if legacy {
        let Ok(service) = server.serve_with_ct(transport, ct).await else {
            return;
        };
        service
    } else {
        // rmcp 3.2's negotiation path awaits the first handler before polling
        // its outgoing channel. A long-lived subscriptions/listen deadlocks
        // there. Start the SDK service loop directly for metadata-based clients;
        // it validates each request and can emit the initial acknowledgment.
        rmcp::service::serve_directly_with_ct(server, transport, None, ct)
    };
    let _ = service.waiting().await;
}

struct PrefetchedTransport<T> {
    first: Option<ClientJsonRpcMessage>,
    inner: T,
    require_metadata: bool,
}

impl<T: Transport<RoleServer>> Transport<RoleServer> for PrefetchedTransport<T> {
    type Error = T::Error;

    fn send(
        &mut self,
        message: ServerJsonRpcMessage,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send + 'static {
        self.inner.send(message)
    }

    async fn receive(&mut self) -> Option<ClientJsonRpcMessage> {
        loop {
            let message = if let Some(first) = self.first.take() {
                first
            } else {
                self.inner.receive().await?
            };
            // serve_directly supports legacy sessions too, so it does not
            // enforce the metadata lifecycle itself. Keep that boundary here.
            if self.require_metadata {
                if let ClientJsonRpcMessage::Request(request) = &message {
                    let missing = request
                        .request
                        .get_meta()
                        .missing_required_keys(&ProtocolVersion::V_2026_07_28);
                    if !missing.is_empty() {
                        let error = McpError::invalid_params(
                            format!(
                                "Request metadata is missing or invalid: {}",
                                missing.join(", ")
                            ),
                            None,
                        );
                        self.inner
                            .send(ServerJsonRpcMessage::error(error, Some(request.id.clone())))
                            .await
                            .ok()?;
                        continue;
                    }
                }
            }
            return Some(message);
        }
    }

    async fn close(&mut self) -> Result<(), Self::Error> {
        self.inner.close().await
    }
}

// Keep the SDK's protocol/error handling while bounding its line buffer,
// including malicious input that never supplies a newline.
struct BoundedMessageReader<R> {
    inner: R,
    line_bytes: usize,
}

impl<R> BoundedMessageReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            line_bytes: 0,
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for BoundedMessageReader<R> {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = self.get_mut();
        let before = buffer.filled().len();
        match std::pin::Pin::new(&mut this.inner).poll_read(context, buffer) {
            std::task::Poll::Ready(Ok(())) => {
                for byte in &buffer.filled()[before..] {
                    if *byte == b'\n' {
                        this.line_bytes = 0;
                    } else {
                        this.line_bytes += 1;
                        if this.line_bytes > MAX_REQUEST_BYTES {
                            buffer.set_filled(before);
                            return std::task::Poll::Ready(Err(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "MCP request exceeds 256 KiB",
                            )));
                        }
                    }
                }
                std::task::Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}

/// Run the installed executable as an MCP stdio subprocess, without Tauri UI.
pub fn run_mcp_stdio() -> Result<(), String> {
    // Match Tauri's app_config_dir without building a GUI runtime.
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .map_err(|_| "Could not read the bundled app configuration".to_string())?;
    let identifier = config["identifier"]
        .as_str()
        .ok_or_else(|| "The bundled app identifier is missing".to_string())?;
    let token_path = dirs::config_dir()
        .ok_or_else(|| "Could not resolve the app configuration directory".to_string())?
        .join(identifier)
        .join(MCP_TOKEN_FILE_NAME);
    let token = fs::read_to_string(token_path).map_err(|_| {
        "Open Scratchpad and enable read-only agent access before connecting".to_string()
    })?;
    let token = validate_token(token.trim())?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Could not start the MCP runtime: {error}"))?;
    let result = runtime.block_on(async {
        let stream = connect_to_editor(("127.0.0.1", MCP_PORT), token).await?;
        relay_stdio(stream, tokio::io::stdin(), tokio::io::stdout())
            .await
            .map_err(|_| {
                "The MCP connection closed unexpectedly; reconnect your client".to_string()
            })
    });
    // Tokio's stdin reader can block until more input arrives. Do not wait for
    // that blocking thread when the editor closes or disables agent access.
    runtime.shutdown_background();
    result
}

async fn connect_to_editor(
    address: impl tokio::net::ToSocketAddrs,
    token: &str,
) -> Result<TcpStream, String> {
    tokio::time::timeout(CONNECTION_TIMEOUT, async {
        let mut stream = TcpStream::connect(address).await?;
        stream.set_nodelay(true)?;
        stream.write_all(token.as_bytes()).await?;
        stream.write_all(b"\n").await?;
        if stream.read_u8().await? != 1 {
            return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        }
        Ok::<_, std::io::Error>(stream)
    })
    .await
    .map_err(|_| {
        "Scratchpad did not respond; open the app, enable agent access, and reconnect".to_string()
    })?
    .map_err(|_| {
        "Cannot connect to Scratchpad; open the app, enable read-only agent access, and reconnect"
            .to_string()
    })
}

async fn relay_stdio(
    stream: TcpStream,
    mut input: impl AsyncRead + Unpin,
    mut output: impl AsyncWrite + Unpin,
) -> std::io::Result<()> {
    let (mut reader, mut writer) = stream.into_split();
    tokio::select! {
        result = tokio::io::copy(&mut input, &mut writer) => result.map(|_| ()),
        result = async {
            let mut buffer = [0u8; 8192];
            loop {
                let count = reader.read(&mut buffer).await?;
                if count == 0 { return Ok(()); }
                output.write_all(&buffer[..count]).await?;
                output.flush().await?;
            }
        } => result,
    }
}

fn load_or_create_token(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(token) => validate_token(token.trim()).map(str::to_owned),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| "The MCP token path has no parent directory".to_string())?;
            fs::create_dir_all(parent).map_err(|error| {
                format!("Could not create the app configuration directory: {error}")
            })?;
            let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            write_private_token(path, &token)?;
            Ok(token)
        }
        Err(error) => Err(format!("Could not read the MCP access token: {error}")),
    }
}

fn validate_token(token: &str) -> Result<&str, String> {
    if token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(token)
    } else {
        Err("The saved MCP access token is invalid".into())
    }
}

#[cfg(unix)]
fn write_private_token(path: &Path, token: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| format!("Could not create the MCP access token: {error}"))?;
    file.write_all(token.as_bytes())
        .map_err(|error| format!("Could not save the MCP access token: {error}"))
}

#[cfg(not(unix))]
fn write_private_token(path: &Path, token: &str) -> Result<(), String> {
    use std::io::Write;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Could not create the MCP access token: {error}"))?;
    file.write_all(token.as_bytes())
        .map_err(|error| format!("Could not save the MCP access token: {error}"))
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ListFoldersArgs {
    /// Maximum folders to return (1-200, default 50).
    limit: Option<u32>,
    /// Number of folders to skip (default 0).
    offset: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ListNotesArgs {
    /// Return only notes assigned to this folder id.
    folder_id: Option<String>,
    /// Maximum notes to return (1-200, default 50).
    limit: Option<u32>,
    /// Number of notes to skip (default 0).
    offset: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SearchNotesArgs {
    /// Literal text to find in note titles or Markdown content.
    query: String,
    /// Return only notes assigned to this folder id.
    folder_id: Option<String>,
    /// Maximum notes to return (1-200, default 50).
    limit: Option<u32>,
    /// Number of matching notes to skip (default 0).
    offset: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct GetNoteArgs {
    /// Stable note id returned by list_notes or search_notes.
    id: String,
    /// Character offset in the Markdown content (default 0).
    offset: Option<u32>,
    /// Maximum content characters to return (1-100000, default 20000).
    limit: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct FolderSummary {
    id: String,
    name: String,
    note_count: usize,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NoteSummary {
    id: String,
    title: String,
    preview: String,
    folder_id: Option<String>,
    folder_name: Option<String>,
    updated_at: i64,
    is_pinned: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct FoldersPage {
    collection_name: String,
    folders: Vec<FolderSummary>,
    next_offset: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NotesPage {
    collection_name: String,
    notes: Vec<NoteSummary>,
    next_offset: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NoteDetail {
    collection_name: String,
    id: String,
    title: String,
    content: String,
    updated_at: i64,
    is_title_locked: bool,
    is_pinned: bool,
    folder_id: Option<String>,
    folder_name: Option<String>,
    offset: u32,
    next_offset: Option<u32>,
    total_length: u32,
    truncated: bool,
}

fn page_size(limit: Option<u32>, maximum: u32, default: u32) -> Result<u32, McpError> {
    let limit = limit.unwrap_or(default);
    if !(1..=maximum).contains(&limit) {
        return Err(McpError::invalid_params(
            format!("limit must be between 1 and {maximum}"),
            None,
        ));
    }
    Ok(limit)
}

fn preview(content: &str) -> String {
    let flattened: String = content
        .chars()
        .map(|character| match character {
            '\n' | '\r' => ' ',
            other => other,
        })
        .collect();
    let trimmed = flattened.trim();
    if trimmed.chars().count() <= PREVIEW_CHARS {
        trimmed.to_string()
    } else {
        format!(
            "{}…",
            trimmed.chars().take(PREVIEW_CHARS).collect::<String>()
        )
    }
}

fn next_offset(total: usize, offset: u32, limit: u32) -> Option<u32> {
    ((offset as usize).saturating_add(limit as usize) < total).then(|| offset.saturating_add(limit))
}

fn folder_names(snapshot: &Snapshot) -> HashMap<&str, &str> {
    snapshot
        .folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder.name.as_str()))
        .collect()
}

fn note_summary(note: &Note, names: &HashMap<&str, &str>) -> NoteSummary {
    NoteSummary {
        id: note.id.clone(),
        title: note.title.clone(),
        preview: preview(&note.content),
        folder_id: note.folder_id.clone(),
        folder_name: note
            .folder_id
            .as_deref()
            .and_then(|id| names.get(id).copied())
            .map(str::to_owned),
        updated_at: note.updated_at,
        is_pinned: note.is_pinned,
    }
}

fn list_folders_data(snapshot: &Snapshot, limit: u32, offset: u32) -> FoldersPage {
    let total = snapshot.folders.len();
    let folders = snapshot
        .folders
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|folder| FolderSummary {
            id: folder.id.clone(),
            name: folder.name.clone(),
            note_count: snapshot
                .notes
                .iter()
                .filter(|note| note.folder_id.as_deref() == Some(folder.id.as_str()))
                .count(),
        })
        .collect();
    FoldersPage {
        collection_name: snapshot.collection_name.clone(),
        folders,
        next_offset: next_offset(total, offset, limit),
    }
}

fn list_notes_data(
    snapshot: &Snapshot,
    folder_id: Option<&str>,
    limit: u32,
    offset: u32,
) -> NotesPage {
    let names = folder_names(snapshot);
    let matching: Vec<_> = snapshot
        .notes
        .iter()
        .filter(|note| folder_id.is_none_or(|id| note.folder_id.as_deref() == Some(id)))
        .collect();
    let notes = matching
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|note| note_summary(note, &names))
        .collect();
    NotesPage {
        collection_name: snapshot.collection_name.clone(),
        next_offset: next_offset(matching.len(), offset, limit),
        notes,
    }
}

fn search_notes_data(
    snapshot: &Snapshot,
    query: &str,
    folder_id: Option<&str>,
    limit: u32,
    offset: u32,
) -> NotesPage {
    let query = query.to_lowercase();
    let names = folder_names(snapshot);
    let matching: Vec<_> = snapshot
        .notes
        .iter()
        .filter(|note| folder_id.is_none_or(|id| note.folder_id.as_deref() == Some(id)))
        .filter(|note| {
            note.title.to_lowercase().contains(&query)
                || note.content.to_lowercase().contains(&query)
        })
        .collect();
    let notes = matching
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|note| note_summary(note, &names))
        .collect();
    NotesPage {
        collection_name: snapshot.collection_name.clone(),
        next_offset: next_offset(matching.len(), offset, limit),
        notes,
    }
}

fn get_note_data(
    snapshot: &Snapshot,
    id: &str,
    offset: u32,
    limit: u32,
) -> Result<NoteDetail, String> {
    let note = snapshot
        .notes
        .iter()
        .find(|note| note.id == id)
        .ok_or_else(|| format!("No note exists with id `{id}`."))?;
    let total_length = u32::try_from(note.content.chars().count())
        .map_err(|_| "This note is too large to address with character offsets.".to_string())?;
    if offset > total_length {
        return Err(format!(
            "Content offset {offset} exceeds the note length of {total_length} characters."
        ));
    }
    let content: String = note
        .content
        .chars()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();
    let returned = u32::try_from(content.chars().count())
        .map_err(|_| "The returned note chunk is too large.".to_string())?;
    let end = offset.saturating_add(returned);
    let truncated = end < total_length;
    let names = folder_names(snapshot);
    Ok(NoteDetail {
        collection_name: snapshot.collection_name.clone(),
        id: note.id.clone(),
        title: note.title.clone(),
        content,
        updated_at: note.updated_at,
        is_title_locked: note.is_title_locked,
        is_pinned: note.is_pinned,
        folder_id: note.folder_id.clone(),
        folder_name: note
            .folder_id
            .as_deref()
            .and_then(|folder_id| names.get(folder_id).copied())
            .map(str::to_owned),
        offset,
        next_offset: truncated.then_some(end),
        total_length,
        truncated,
    })
}

fn successful_result<T: Serialize>(value: T) -> Result<CallToolResult, McpError> {
    serde_json::to_value(value)
        .map(CallToolResult::structured)
        .map_err(|error| McpError::internal_error(error.to_string(), None))
}

fn tool_error(message: String) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message)])
}

#[derive(Clone)]
struct ScratchpadServer {
    snapshot: SharedSnapshot,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl ScratchpadServer {
    fn new(snapshot: SharedSnapshot) -> Self {
        Self {
            snapshot,
            tool_router: Self::tool_router(),
        }
    }

    fn with_snapshot<T>(&self, operation: impl FnOnce(&Snapshot) -> T) -> Result<T, McpError> {
        let snapshot = self.snapshot.read().map_err(|_| {
            McpError::internal_error("The Scratchpad snapshot is unavailable", None)
        })?;
        Ok(operation(&snapshot))
    }
}

#[tool_router]
impl ScratchpadServer {
    /// List folders in sidebar order, including the number of assigned notes.
    #[tool(annotations(
        title = "List folders",
        read_only_hint = true,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn list_folders(
        &self,
        Parameters(args): Parameters<ListFoldersArgs>,
    ) -> Result<CallToolResult, McpError> {
        let limit = page_size(args.limit, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)?;
        let page = self.with_snapshot(|snapshot| {
            list_folders_data(snapshot, limit, args.offset.unwrap_or(0))
        })?;
        successful_result(page)
    }

    /// List note metadata and short previews in sidebar order. Use get_note for content.
    #[tool(annotations(
        title = "List notes",
        read_only_hint = true,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn list_notes(
        &self,
        Parameters(args): Parameters<ListNotesArgs>,
    ) -> Result<CallToolResult, McpError> {
        let limit = page_size(args.limit, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)?;
        let page = self.with_snapshot(|snapshot| {
            list_notes_data(
                snapshot,
                args.folder_id.as_deref(),
                limit,
                args.offset.unwrap_or(0),
            )
        })?;
        successful_result(page)
    }

    /// Search note titles and Markdown content for literal text.
    #[tool(annotations(
        title = "Search notes",
        read_only_hint = true,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn search_notes(
        &self,
        Parameters(args): Parameters<SearchNotesArgs>,
    ) -> Result<CallToolResult, McpError> {
        if args.query.trim().is_empty() {
            return Err(McpError::invalid_params("query must not be empty", None));
        }
        let limit = page_size(args.limit, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)?;
        let page = self.with_snapshot(|snapshot| {
            search_notes_data(
                snapshot,
                &args.query,
                args.folder_id.as_deref(),
                limit,
                args.offset.unwrap_or(0),
            )
        })?;
        successful_result(page)
    }

    /// Read one note by id, returning a character-addressed chunk of Markdown content.
    #[tool(annotations(
        title = "Get note",
        read_only_hint = true,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn get_note(
        &self,
        Parameters(args): Parameters<GetNoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        if args.id.trim().is_empty() {
            return Err(McpError::invalid_params("id must not be empty", None));
        }
        let limit = page_size(args.limit, MAX_CONTENT_CHARS, DEFAULT_CONTENT_CHARS)?;
        let note = self.with_snapshot(|snapshot| {
            get_note_data(snapshot, &args.id, args.offset.unwrap_or(0), limit)
        })?;
        match note {
            Ok(note) => successful_result(note),
            Err(error) => Ok(tool_error(error)),
        }
    }
}

#[tool_handler]
impl ServerHandler for ScratchpadServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("scratchpad-mcp", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "Read-only access to the collection currently open in Scratchpad, including unsaved edits. Results are paginated; follow nextOffset until it is null. get_note offsets count Unicode characters, not bytes.",
            )
    }

    fn accepted_subscription_filter(
        &self,
        requested: &SubscriptionFilter,
    ) -> Option<SubscriptionFilter> {
        // Some clients establish a modern notification stream even when the
        // server advertises no list-change capabilities. Acknowledge the
        // supported intersection (currently empty) so tool discovery remains
        // usable without claiming that Scratchpad emits change notifications.
        Some(requested.supported_by(&self.get_info().capabilities))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncBufReadExt, BufReader};

    fn snapshot() -> Snapshot {
        Snapshot {
            collection_name: "Project notes".into(),
            folders: vec![Folder {
                id: "work".into(),
                name: "Work".into(),
            }],
            notes: vec![
                Note {
                    id: "one".into(),
                    title: "First".into(),
                    content: "Live unsaved body with café".into(),
                    updated_at: 20,
                    is_title_locked: true,
                    is_pinned: true,
                    folder_id: Some("work".into()),
                },
                Note {
                    id: "two".into(),
                    title: "Second".into(),
                    content: "Other body".into(),
                    updated_at: 10,
                    is_title_locked: false,
                    is_pinned: false,
                    folder_id: None,
                },
            ],
        }
    }

    #[test]
    fn lists_and_searches_the_live_snapshot_in_sidebar_order() {
        let snapshot = snapshot();
        let folders = list_folders_data(&snapshot, 50, 0);
        assert_eq!(folders.collection_name, "Project notes");
        assert_eq!(folders.folders[0].note_count, 1);

        let page = list_notes_data(&snapshot, None, 1, 0);
        assert_eq!(page.notes[0].id, "one");
        assert_eq!(page.next_offset, Some(1));

        let search = search_notes_data(&snapshot, "CAFÉ", None, 50, 0);
        assert_eq!(search.notes.len(), 1);
        assert_eq!(search.notes[0].id, "one");
    }

    #[test]
    fn reads_unicode_content_by_character_offset() {
        let snapshot = snapshot();
        let note = get_note_data(&snapshot, "one", 23, 4).expect("note should be readable");
        assert_eq!(note.content, "café");
        assert_eq!(note.total_length, 27);
        assert!(!note.truncated);
    }

    #[tokio::test]
    async fn local_channel_rejects_invalid_authentication() {
        let (address, _, cancellation, task) = start_test_server().await;
        assert!(connect_to_editor(address, &"b".repeat(64)).await.is_err());
        let connection = connect_to_editor(address, &"a".repeat(64)).await;
        assert!(connection.is_ok());
        cancellation.cancel();
        task.await.unwrap();
    }

    #[tokio::test]
    async fn request_limit_applies_per_line_and_rejects_unterminated_input() {
        let mut reader = BoundedMessageReader::new(&b"abc\ndef\n"[..]);
        let mut content = String::new();
        reader.read_to_string(&mut content).await.unwrap();
        assert_eq!(content, "abc\ndef\n");
        assert_eq!(reader.line_bytes, 0);

        let oversized = vec![b'x'; MAX_REQUEST_BYTES + 1];
        let mut reader = BoundedMessageReader::new(oversized.as_slice());
        assert_eq!(
            reader
                .read_to_end(&mut Vec::new())
                .await
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
    }

    #[tokio::test]
    async fn stdio_relay_discovers_tools_reads_live_edits_and_stops_with_editor() {
        let (address, snapshot, cancellation, server) = start_test_server().await;
        let stream = connect_to_editor(address, &"a".repeat(64)).await.unwrap();
        let (client, child) = tokio::io::duplex(64 * 1024);
        let (input, output) = tokio::io::split(child);
        let bridge = tokio::spawn(relay_stdio(stream, input, output));
        let mut client = BufReader::new(client);
        send_json(
            &mut client,
            serde_json::json!({
                "jsonrpc":"2.0", "id":1, "method":"initialize",
                "params": {"protocolVersion":"2025-06-18", "capabilities":{},
                    "clientInfo":{"name":"stdio-test","version":"1"}}
            }),
        )
        .await;
        let initialized = receive_json(&mut client).await;
        assert_eq!(
            initialized["result"]["serverInfo"]["name"],
            "scratchpad-mcp"
        );
        send_json(
            &mut client,
            serde_json::json!({
                "jsonrpc":"2.0", "method":"notifications/initialized"
            }),
        )
        .await;
        send_json(
            &mut client,
            serde_json::json!({
                "jsonrpc":"2.0", "id":2, "method":"tools/list"
            }),
        )
        .await;
        let tools = receive_json(&mut client).await;
        let tools = tools["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 4);
        for tool in tools {
            assert_eq!(tool["annotations"]["readOnlyHint"], true);
        }
        for (id, method, arguments, field) in [
            (3, "list_folders", serde_json::json!({}), "folders"),
            (4, "list_notes", serde_json::json!({}), "notes"),
            (
                5,
                "search_notes",
                serde_json::json!({"query":"café"}),
                "notes",
            ),
        ] {
            send_json(
                &mut client,
                serde_json::json!({
                    "jsonrpc":"2.0", "id":id, "method":"tools/call",
                    "params":{"name":method, "arguments":arguments}
                }),
            )
            .await;
            let result = receive_json(&mut client).await;
            assert!(!result["result"]["structuredContent"][field]
                .as_array()
                .unwrap()
                .is_empty());
        }
        snapshot.write().unwrap().notes[0].content = "Live café 📝 edit".into();
        send_json(
            &mut client,
            serde_json::json!({
                "jsonrpc":"2.0", "id":6, "method":"tools/call",
                "params":{"name":"get_note", "arguments":{"id":"one"}}
            }),
        )
        .await;
        let note = receive_json(&mut client).await;
        assert_eq!(
            note["result"]["structuredContent"]["content"],
            "Live café 📝 edit"
        );

        // A second client does not steal the first client's session.
        let second = connect_to_editor(address, &"a".repeat(64)).await.unwrap();
        drop(second);
        cancellation.cancel();
        server.await.unwrap();
        tokio::time::timeout(CONNECTION_TIMEOUT, bridge)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(connect_to_editor(address, &"a".repeat(64)).await.is_err());
    }

    #[tokio::test]
    async fn stdio_relay_exits_on_client_eof() {
        let (address, _, cancellation, server) = start_test_server().await;
        let stream = connect_to_editor(address, &"a".repeat(64)).await.unwrap();
        tokio::time::timeout(
            CONNECTION_TIMEOUT,
            relay_stdio(stream, tokio::io::empty(), tokio::io::sink()),
        )
        .await
        .unwrap()
        .unwrap();
        cancellation.cancel();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn modern_notification_listener_is_acknowledged_over_stdio() {
        let (address, _, cancellation, server) = start_test_server().await;
        let stream = connect_to_editor(address, &"a".repeat(64)).await.unwrap();
        let mut client = BufReader::new(stream);
        send_json(&mut client, serde_json::json!({
            "jsonrpc":"2.0", "id":"listen-test", "method":"subscriptions/listen",
            "params":{
                "_meta":{
                    "io.modelcontextprotocol/protocolVersion":"2026-07-28",
                    "io.modelcontextprotocol/clientInfo":{"name":"scratchpad-test","version":"1"},
                    "io.modelcontextprotocol/clientCapabilities":{}
                },
                "notifications":{"toolsListChanged":true}
            }
        })).await;
        let acknowledgment = receive_json(&mut client).await;
        assert_eq!(
            acknowledgment["method"],
            "notifications/subscriptions/acknowledged"
        );
        assert!(!acknowledgment
            .to_string()
            .contains("toolsListChanged\":true"));
        send_json(
            &mut client,
            serde_json::json!({
                "jsonrpc":"2.0", "id":2, "method":"tools/list"
            }),
        )
        .await;
        assert!(receive_json(&mut client).await["error"].is_object());
        send_json(
            &mut client,
            serde_json::json!({
                "jsonrpc":"2.0", "id":3, "method":"tools/list",
                "params":{"_meta":{
                    "io.modelcontextprotocol/protocolVersion":"2026-07-28",
                    "io.modelcontextprotocol/clientCapabilities":{}
                }}
            }),
        )
        .await;
        let tools = receive_json(&mut client).await;
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 4);
        cancellation.cancel();
        server.await.unwrap();
    }

    async fn start_test_server() -> (
        std::net::SocketAddr,
        SharedSnapshot,
        CancellationToken,
        JoinHandle<()>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let snapshot = Arc::new(RwLock::new(snapshot()));
        let cancellation = CancellationToken::new();
        let task = tokio::spawn(serve_local_connections(
            listener,
            snapshot.clone(),
            "a".repeat(64),
            cancellation.clone(),
        ));
        (address, snapshot, cancellation, task)
    }

    async fn send_json(stream: &mut (impl AsyncWrite + Unpin), value: serde_json::Value) {
        let mut bytes = serde_json::to_vec(&value).unwrap();
        bytes.push(b'\n');
        stream.write_all(&bytes).await.unwrap();
        stream.flush().await.unwrap();
    }

    async fn receive_json(
        stream: &mut (impl tokio::io::AsyncBufRead + Unpin),
    ) -> serde_json::Value {
        let mut line = String::new();
        tokio::time::timeout(CONNECTION_TIMEOUT, stream.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[test]
    fn creates_and_reuses_a_private_token() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "scratchpad-mcp-token-{}-{unique}",
            std::process::id()
        ));
        let path = directory.join("token");

        let first = load_or_create_token(&path).expect("token should be created");
        let second = load_or_create_token(&path).expect("token should be reused");
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);

        std::fs::remove_file(path).expect("temporary token should be removable");
        std::fs::remove_dir(directory).expect("temporary directory should be removable");
    }
}
