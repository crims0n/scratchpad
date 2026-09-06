// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::{HashMap, HashSet};
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
use tauri::{Emitter, Manager};
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
    collection_id: String,
    note_revisions: HashMap<String, String>,
    folder_revisions: HashMap<String, String>,
    writes: Arc<WriteBridge>,
    notes: Vec<Note>,
    folders: Vec<Folder>,
    trash: Vec<TrashSummary>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            collection_name: "Local notes".into(),
            collection_id: String::new(),
            note_revisions: HashMap::new(),
            folder_revisions: HashMap::new(),
            writes: Arc::new(WriteBridge::default()),
            notes: Vec::new(),
            folders: Vec::new(),
            trash: Vec::new(),
        }
    }
}

type SharedSnapshot = Arc<RwLock<Snapshot>>;

// Requests go to the editor, which owns the live collection and persistence queue.
// A response timeout is deliberately an unknown outcome: retry the same requestId.
#[derive(Debug)]
struct WriteBridge {
    app: RwLock<Option<tauri::AppHandle>>,
    permissions: RwLock<HashSet<String>>,
    pending: std::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteEvent {
    ticket: String,
    operation: &'static str,
    arguments: serde_json::Value,
}

const READ_TOOLS: [&str; 5] = [
    "list_folders",
    "list_notes",
    "search_notes",
    "get_note",
    "list_trash",
];
const WRITE_TOOLS: [&str; 8] = [
    "create_note",
    "create_folder",
    "append_to_note",
    "rename_note",
    "move_note",
    "rename_folder",
    "delete_note",
    "delete_folder",
];

impl Default for WriteBridge {
    fn default() -> Self {
        Self {
            app: RwLock::new(None),
            permissions: RwLock::new(READ_TOOLS.into_iter().map(String::from).collect()),
            pending: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

fn permission_set(tools: Vec<String>) -> Result<HashSet<String>, String> {
    if tools
        .iter()
        .any(|tool| !READ_TOOLS.contains(&tool.as_str()) && !WRITE_TOOLS.contains(&tool.as_str()))
    {
        return Err("Unknown MCP function permission".into());
    }
    Ok(tools.into_iter().collect())
}

#[tauri::command]
pub(crate) fn set_mcp_permissions(
    state: tauri::State<'_, McpState>,
    tools: Vec<String>,
) -> Result<(), String> {
    let permissions = permission_set(tools)?;
    let snapshot = state.snapshot.read().map_err(|e| e.to_string())?;
    *snapshot
        .writes
        .permissions
        .write()
        .map_err(|e| e.to_string())? = permissions;
    Ok(())
}

#[tauri::command]
pub(crate) fn complete_mcp_write(
    state: tauri::State<'_, McpState>,
    ticket: String,
    result: serde_json::Value,
) -> Result<(), String> {
    let snapshot = state.snapshot.read().map_err(|e| e.to_string())?;
    if let Some(sender) = snapshot
        .writes
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&ticket)
    {
        let _ = sender.send(result);
    }
    Ok(())
}

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
#[allow(clippy::too_many_arguments)]
pub(crate) fn update_mcp_snapshot(
    state: tauri::State<'_, McpState>,
    collection_name: String,
    collection_id: String,
    note_revisions: HashMap<String, String>,
    folder_revisions: HashMap<String, String>,
    notes: Vec<Note>,
    folders: Vec<Folder>,
    trash: Vec<TrashSummary>,
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
        collection_id,
        note_revisions,
        folder_revisions,
        writes: snapshot.writes.clone(),
        collection_name: collection_name.chars().take(200).collect(),
        notes,
        folders,
        trash,
    };
    Ok(())
}

#[tauri::command]
pub(crate) fn update_mcp_note(
    state: tauri::State<'_, McpState>,
    note: Note,
    revision: String,
    collection_id: String,
) -> Result<(), String> {
    let mut snapshot = state
        .snapshot
        .write()
        .map_err(|_| "The MCP note snapshot is unavailable".to_string())?;
    if snapshot.collection_id != collection_id {
        return Err("Collection changed".into());
    }
    let note_id = note.id.clone();
    let existing = snapshot
        .notes
        .iter_mut()
        .find(|existing| existing.id == note.id)
        .ok_or_else(|| format!("The MCP snapshot has no note with id `{}`", note.id))?;
    *existing = note;
    snapshot.note_revisions.insert(note_id, revision);
    Ok(())
}

// Reading client configuration never binds a socket or grants agent access.
#[tauri::command]
pub(crate) fn get_mcp_connection_info() -> Result<McpConnectionInfo, String> {
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
    Ok(McpConnectionInfo {
        command,
        args: vec!["--mcp-stdio".into()],
        mode: "readOnly",
    })
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

    let connection = get_mcp_connection_info()?;
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
    {
        let snapshot = state.snapshot.read().map_err(|e| e.to_string())?;
        *snapshot.writes.app.write().map_err(|e| e.to_string())? = Some(app);
        *snapshot
            .writes
            .permissions
            .write()
            .map_err(|e| e.to_string())? = READ_TOOLS.into_iter().map(String::from).collect();
    }
    let cancellation = CancellationToken::new();
    let task = tokio::spawn(serve_local_connections(
        listener,
        state.snapshot.clone(),
        token,
        cancellation.clone(),
    ));
    *running = Some(RunningServer {
        cancellation,
        task,
        connection: connection.clone(),
    });
    Ok(connection)
}

#[tauri::command]
pub(crate) async fn stop_mcp_server(state: tauri::State<'_, McpState>) -> Result<(), String> {
    {
        let snapshot = state.snapshot.read().map_err(|e| e.to_string())?;
        *snapshot
            .writes
            .permissions
            .write()
            .map_err(|e| e.to_string())? = HashSet::new();
    }
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
pub fn run_mcp_stdio(identifier: &str) -> Result<(), String> {
    let token_path = mcp_token_path(identifier)?;
    let token = fs::read_to_string(token_path)
        .map_err(|_| "Open Scratchpad and enable agent access before connecting".to_string())?;
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

fn mcp_token_path(identifier: &str) -> Result<std::path::PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or_else(|| "Could not resolve the app configuration directory".to_string())?
        .join(identifier)
        .join(MCP_TOKEN_FILE_NAME))
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
        "Cannot connect to Scratchpad; open the app, enable agent access, and reconnect".to_string()
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

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AppendNoteArgs {
    /// Current collection ID returned by get_note.
    collection_id: String,
    /// Unique retry key. Reuse exactly the same arguments when retrying.
    request_id: String,
    /// Existing note ID returned by get_note.
    note_id: String,
    /// Opaque revision returned by get_note; conflicts require rereading.
    expected_revision: String,
    /// Exact text to append (1-100000 UTF-8 bytes). Include your own newlines.
    content: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RenameNoteArgs {
    /// Current collection ID from get_note.
    collection_id: String,
    /// Unique retry key (1-128 characters). Reuse identical arguments on retry.
    request_id: String,
    /// Existing target ID from get_note.
    note_id: String,
    /// Opaque revision from get_note; conflicts require rereading.
    expected_revision: String,
    /// New explicit title (1-200 characters); locks automatic title generation.
    title: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MoveNoteArgs {
    /// Current collection ID from get_note.
    collection_id: String,
    /// Unique retry key (1-128 characters). Reuse identical arguments on retry.
    request_id: String,
    /// Existing target ID from get_note.
    note_id: String,
    /// Opaque revision from get_note; conflicts require rereading.
    expected_revision: String,
    /// Destination folder ID, or null for top level. Must be explicitly supplied.
    #[serde(deserialize_with = "deserialize_destination")]
    #[schemars(required, schema_with = "nullable_destination_schema")]
    folder_id: Option<String>,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RenameFolderArgs {
    /// Current collection ID from list_folders.
    collection_id: String,
    /// Unique retry key (1-128 characters). Reuse identical arguments on retry.
    request_id: String,
    /// Existing target ID from list_folders.
    folder_id: String,
    /// Opaque revision from list_folders; conflicts require rereading.
    expected_revision: String,
    /// New folder name (1-200 characters); duplicate and reserved names are rejected.
    name: String,
}

fn nullable_destination_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    // `required` alone unwraps Option's schema. Presence is mandatory, but a
    // JSON null is still a valid destination and means the workspace top level.
    schemars::json_schema!({ "type": ["string", "null"] })
}

fn deserialize_destination<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(deserializer)
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DeleteNoteArgs {
    /// Current collection ID from get_note.
    collection_id: String,
    /// Unique retry key. Reuse identical arguments on retry.
    request_id: String,
    /// Existing target ID from get_note.
    note_id: String,
    /// Current revision from get_note; conflicts require rereading.
    expected_revision: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DeleteFolderArgs {
    /// Current collection ID from list_folders.
    collection_id: String,
    /// Unique retry key. Reuse identical arguments on retry.
    request_id: String,
    /// Existing target ID from list_folders.
    folder_id: String,
    /// Current revision from list_folders; conflicts require rereading.
    expected_revision: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateNoteArgs {
    /// Collection ID from a recent list_notes or list_folders result.
    collection_id: String,
    /// Unique retry key (1-128 characters). Reuse with identical arguments on retry.
    request_id: String,
    /// Explicit title (1-200 characters after trimming).
    title: String,
    /// Markdown content, at most 100000 UTF-8 bytes. Defaults to empty.
    #[serde(default)]
    content: String,
    /// Existing destination folder ID. Omit for top level.
    folder_id: Option<String>,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateFolderArgs {
    /// Collection ID from a recent list_notes or list_folders result.
    collection_id: String,
    /// Unique retry key (1-128 characters). Reuse with identical arguments on retry.
    request_id: String,
    /// Folder name (1-200 characters); duplicate and reserved names are rejected.
    name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ListFoldersArgs {
    /// Maximum entries to return (1-200, default 50).
    limit: Option<u32>,
    /// Number of entries to skip (default 0).
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

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashSummary {
    id: String,
    note_id: String,
    title: String,
    deleted_at: i64,
    folder_id: Option<String>,
    folder_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashPage {
    collection_name: String,
    collection_id: String,
    trash: Vec<TrashSummary>,
    next_offset: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct FolderSummary {
    revision: String,
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
    collection_id: String,
    folders: Vec<FolderSummary>,
    next_offset: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NotesPage {
    collection_name: String,
    collection_id: String,
    notes: Vec<NoteSummary>,
    next_offset: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NoteDetail {
    revision: String,
    collection_name: String,
    collection_id: String,
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
            revision: snapshot
                .folder_revisions
                .get(&folder.id)
                .cloned()
                .unwrap_or_default(),
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
        collection_id: snapshot.collection_id.clone(),
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
        collection_id: snapshot.collection_id.clone(),
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
        collection_id: snapshot.collection_id.clone(),
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
        revision: snapshot
            .note_revisions
            .get(&note.id)
            .cloned()
            .unwrap_or_default(),
        collection_name: snapshot.collection_name.clone(),
        collection_id: snapshot.collection_id.clone(),
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

    fn is_allowed(&self, operation: &str) -> Result<bool, McpError> {
        let writes = self.with_snapshot(|s| s.writes.clone())?;
        let permissions = writes
            .permissions
            .read()
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        Ok(permissions.contains(operation))
    }

    async fn write(
        &self,
        operation: &'static str,
        arguments: serde_json::Value,
    ) -> Result<CallToolResult, McpError> {
        let (writes, collection_id) =
            self.with_snapshot(|s| (s.writes.clone(), s.collection_id.clone()))?;
        let appending = operation == "append_to_note";
        if !self.is_allowed(operation)? {
            return Ok(tool_error(format!(
                "Permission for {operation} is disabled. Enable it in MCP Configuration."
            )));
        }
        if arguments["collectionId"].as_str() != Some(collection_id.as_str()) {
            return Ok(tool_error(
                "Collection changed; read the current collection before writing.".into(),
            ));
        }
        let request_id = arguments["requestId"].as_str().unwrap_or_default();
        if request_id.trim().is_empty() || request_id.chars().count() > 128 {
            return Err(McpError::invalid_params(
                "requestId must contain 1-128 characters",
                None,
            ));
        }
        let deleting = operation == "delete_note" || operation == "delete_folder";
        let changing_folder = operation == "rename_folder" || operation == "delete_folder";
        let editing = appending
            || changing_folder
            || operation == "rename_note"
            || operation == "move_note"
            || deleting;
        if editing {
            let id = arguments[if changing_folder {
                "folderId"
            } else {
                "noteId"
            }]
            .as_str()
            .unwrap_or_default();
            let revision = arguments["expectedRevision"].as_str().unwrap_or_default();
            if id.trim().is_empty()
                || id.chars().count() > 200
                || revision.trim().is_empty()
                || revision.len() > 128
            {
                return Err(McpError::invalid_params("Editing requires an existing ID and expectedRevision from get_note or list_folders", None));
            }
        }
        if appending {
            let content = arguments["content"].as_str().unwrap_or_default();
            if content.is_empty() || content.len() > 100_000 {
                return Err(McpError::invalid_params(
                    "Appending requires 1-100000 UTF-8 bytes of content",
                    None,
                ));
            }
        } else if operation == "move_note" {
            if !arguments["folderId"].is_null() {
                let id = arguments["folderId"].as_str().unwrap_or_default();
                if id.trim().is_empty() || id.chars().count() > 200 {
                    return Err(McpError::invalid_params(
                        "folderId must be an existing folder ID or null for top level",
                        None,
                    ));
                }
            }
        } else if !deleting {
            let field = if operation == "create_note" || operation == "rename_note" {
                "title"
            } else {
                "name"
            };
            let name = arguments[field].as_str().unwrap_or_default().trim();
            if name.is_empty()
                || name.chars().count() > 200
                || arguments["content"].as_str().unwrap_or_default().len() > 100_000
            {
                return Err(McpError::invalid_params("Name/title must contain 1-200 characters and content at most 100000 UTF-8 bytes", None));
            }
        }
        let app = writes
            .app
            .read()
            .map_err(|e| McpError::internal_error(e.to_string(), None))?
            .clone();
        let Some(app) = app else {
            return Ok(tool_error("The editor is unavailable".into()));
        };
        let ticket = Uuid::new_v4().to_string();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        {
            let mut pending = writes
                .pending
                .lock()
                .map_err(|e| McpError::internal_error(e.to_string(), None))?;
            if pending.len() >= 32 {
                return Ok(tool_error(
                    "Too many pending writes; retry with the same requestId".into(),
                ));
            }
            pending.insert(ticket.clone(), sender);
        }
        // The guard also cleans up if the client disconnects and cancels this future.
        struct PendingGuard(Arc<WriteBridge>, String);
        impl Drop for PendingGuard {
            fn drop(&mut self) {
                if let Ok(mut pending) = self.0.pending.lock() {
                    pending.remove(&self.1);
                }
            }
        }
        let _guard = PendingGuard(writes, ticket.clone());
        app.emit_to(
            "main",
            "mcp-write-request",
            WriteEvent {
                ticket,
                operation,
                arguments,
            },
        )
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        match tokio::time::timeout(std::time::Duration::from_secs(30), receiver).await {
            Ok(Ok(result)) if result["ok"] == true => successful_result(result),
            Ok(Ok(result)) => Ok(tool_error(
                result["error"].as_str().unwrap_or("Write failed").into(),
            )),
            _ => Ok(tool_error(
                "Write outcome unknown; retry with the same requestId and arguments".into(),
            )),
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
    /// Append exact text to an existing note. Requires separate editing permission and a current get_note revision. On a save failure the append remains unsaved in the editor; retry identical arguments to save without appending twice.
    #[tool(annotations(
        title = "Append to note",
        read_only_hint = false,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn append_to_note(
        &self,
        Parameters(args): Parameters<AppendNoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "append_to_note",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// Create a note without changing the editor selection. Requires explicit write access.
    #[tool(annotations(
        title = "Create note",
        read_only_hint = false,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn create_note(
        &self,
        Parameters(args): Parameters<CreateNoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "create_note",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// Create a folder. Requires explicit write access. Retry using the same requestId.
    #[tool(annotations(
        title = "Create folder",
        read_only_hint = false,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn create_folder(
        &self,
        Parameters(args): Parameters<CreateFolderArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "create_folder",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// Rename a note and lock its title against automatic title generation. Requires a current get_note revision. Retry identical arguments after a save failure; the change may already be visible in the editor.
    #[tool(annotations(
        title = "Rename note",
        read_only_hint = false,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn rename_note(
        &self,
        Parameters(args): Parameters<RenameNoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "rename_note",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// Move a note to an existing folder or null for top level, preserving content and pin state. Requires a current get_note revision. Retry identical arguments after a save failure; the change may already be visible in the editor.
    #[tool(annotations(
        title = "Move note",
        read_only_hint = false,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn move_note(
        &self,
        Parameters(args): Parameters<MoveNoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "move_note",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// Rename an existing folder without changing its ID or note assignments. Requires its current revision from list_folders; duplicate and reserved names are rejected. Retry identical arguments after a save failure; the change may already be visible in the editor.
    #[tool(annotations(
        title = "Rename folder",
        read_only_hint = false,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn rename_folder(
        &self,
        Parameters(args): Parameters<RenameFolderArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "rename_folder",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// Move a note into persistent trash. Requires a current get_note revision. The user can restore it; agents cannot permanently delete trash. Retry identical arguments after a timeout or save failure.
    #[tool(annotations(
        title = "Delete note",
        read_only_hint = false,
        destructive_hint = true,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn delete_note(
        &self,
        Parameters(args): Parameters<DeleteNoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "delete_note",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// Delete an empty folder. Requires a current list_folders revision. Nonempty folders are rejected, including folders containing pinned notes. Move their notes first. Retry identical arguments after a timeout or save failure.
    #[tool(annotations(
        title = "Delete empty folder",
        read_only_hint = false,
        destructive_hint = true,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn delete_folder(
        &self,
        Parameters(args): Parameters<DeleteFolderArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.write(
            "delete_folder",
            serde_json::to_value(args)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
        )
        .await
    }

    /// List deleted-note metadata in the current collection's trash. Content and permanent deletion are not exposed. Only the user can restore or empty trash in the UI.
    #[tool(annotations(
        title = "List trash",
        read_only_hint = true,
        destructive_hint = false,
        idempotent_hint = true,
        open_world_hint = false
    ))]
    async fn list_trash(
        &self,
        Parameters(args): Parameters<ListFoldersArgs>,
    ) -> Result<CallToolResult, McpError> {
        if !self.is_allowed("list_trash")? {
            return Ok(tool_error(
                "Permission for list_trash is disabled. Enable it in MCP Configuration.".into(),
            ));
        }
        let limit = page_size(args.limit, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)?;
        let offset = args.offset.unwrap_or(0);
        successful_result(self.with_snapshot(|snapshot| {
            TrashPage {
                collection_name: snapshot.collection_name.clone(),
                collection_id: snapshot.collection_id.clone(),
                trash: snapshot
                    .trash
                    .iter()
                    .rev()
                    .skip(offset as usize)
                    .take(limit as usize)
                    .cloned()
                    .collect(),
                next_offset: next_offset(snapshot.trash.len(), offset, limit),
            }
        })?)
    }

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
        if !self.is_allowed("list_folders")? {
            return Ok(tool_error(
                "Permission for list_folders is disabled. Enable it in MCP Configuration.".into(),
            ));
        }
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
        if !self.is_allowed("list_notes")? {
            return Ok(tool_error(
                "Permission for list_notes is disabled. Enable it in MCP Configuration.".into(),
            ));
        }
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
        if !self.is_allowed("search_notes")? {
            return Ok(tool_error(
                "Permission for search_notes is disabled. Enable it in MCP Configuration.".into(),
            ));
        }
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
        if !self.is_allowed("get_note")? {
            return Ok(tool_error(
                "Permission for get_note is disabled. Enable it in MCP Configuration.".into(),
            ));
        }
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
                "Access to the collection currently open in Scratchpad, including unsaved edits. Each function requires its permission enabled in MCP Configuration. All read functions start enabled; all write functions start disabled. delete_note moves a note to persistent trash and requires expectedRevision from get_note. delete_folder requires expectedRevision from list_folders and rejects nonempty folders. list_trash lists recovery metadata; only the user can restore or empty trash through the UI. rename_note and move_note require expectedRevision from get_note. rename_folder requires expectedRevision from list_folders. All edits preserve content except append_to_note, which requires the expectedRevision from get_note, appends exact text, and never adds separators. A revision conflict requires rereading; a save failure requires retrying identical arguments because the change may already be in the editor. Get collectionId from a read result and supply a unique requestId for each write; reuse identical arguments on retries. Retry keys last for this collection session; a switch or app restart invalidates collectionId. Results are paginated; follow nextOffset until it is null. get_note offsets count Unicode characters, not bytes.",
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
            collection_id: "test-collection".into(),
            note_revisions: HashMap::from([("one".into(), "revision-one".into())]),
            folder_revisions: HashMap::from([("work".into(), "revision-work".into())]),
            writes: Arc::new(WriteBridge::default()),
            trash: vec![],
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

    #[tokio::test]
    async fn function_permissions_are_independent_and_reads_can_be_revoked() {
        let snapshot = Arc::new(RwLock::new(snapshot()));
        let server = ScratchpadServer::new(snapshot.clone());
        assert!(server.is_allowed("get_note").unwrap());
        assert!(!server.is_allowed("create_note").unwrap());
        assert!(permission_set(vec!["unknown".into()]).is_err());
        *snapshot.read().unwrap().writes.permissions.write().unwrap() =
            permission_set(vec!["create_note".into()]).unwrap();
        assert!(server.is_allowed("create_note").unwrap());
        assert!(!server.is_allowed("create_folder").unwrap());
        assert!(!server.is_allowed("append_to_note").unwrap());
        assert!(server
            .list_folders(Parameters(ListFoldersArgs {
                limit: None,
                offset: None
            }))
            .await
            .unwrap()
            .is_error
            .unwrap());
        assert!(server
            .list_notes(Parameters(ListNotesArgs {
                folder_id: None,
                limit: None,
                offset: None
            }))
            .await
            .unwrap()
            .is_error
            .unwrap());
        assert!(server
            .search_notes(Parameters(SearchNotesArgs {
                query: "café".into(),
                folder_id: None,
                limit: None,
                offset: None
            }))
            .await
            .unwrap()
            .is_error
            .unwrap());
        assert!(server
            .get_note(Parameters(GetNoteArgs {
                id: "one".into(),
                offset: None,
                limit: None
            }))
            .await
            .unwrap()
            .is_error
            .unwrap());
    }

    #[tokio::test]
    async fn trash_listing_is_paginated_metadata_only_and_permission_gated() {
        let mut data = snapshot();
        data.trash = (0..3)
            .map(|index| TrashSummary {
                id: format!("trash-{index}"),
                note_id: format!("note-{index}"),
                title: format!("Deleted {index}"),
                deleted_at: index,
                folder_id: Some("old-folder".into()),
                folder_name: Some("Old folder".into()),
            })
            .collect();
        let shared = Arc::new(RwLock::new(data));
        let server = ScratchpadServer::new(shared.clone());
        let first = server
            .list_trash(Parameters(ListFoldersArgs {
                limit: Some(2),
                offset: None,
            }))
            .await
            .unwrap();
        let value = serde_json::to_value(first).unwrap();
        let page = &value["structuredContent"];
        assert_eq!(page["collectionId"], "test-collection");
        assert_eq!(page["trash"][0]["id"], "trash-2");
        assert_eq!(page["nextOffset"], 2);
        assert!(page["trash"][0].get("content").is_none());
        assert!(page["trash"][0].get("note").is_none());
        let last = server
            .list_trash(Parameters(ListFoldersArgs {
                limit: Some(2),
                offset: Some(2),
            }))
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_value(last).unwrap()["structuredContent"]["trash"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        shared
            .read()
            .unwrap()
            .writes
            .permissions
            .write()
            .unwrap()
            .remove("list_trash");
        assert!(server
            .list_trash(Parameters(ListFoldersArgs {
                limit: None,
                offset: None
            }))
            .await
            .unwrap()
            .is_error
            .unwrap());
        for forbidden in ["empty_trash", "purge_trash", "restore_note"] {
            assert!(permission_set(vec![forbidden.into()]).is_err());
        }
        for operation in ["delete_note", "delete_folder"] {
            assert!(!server.is_allowed(operation).unwrap());
        }
    }

    #[test]
    fn move_requires_an_explicit_nullable_destination() {
        let mut args = serde_json::json!({"collectionId":"test-collection", "requestId":"move", "noteId":"one", "expectedRevision":"revision-one"});
        assert!(serde_json::from_value::<MoveNoteArgs>(args.clone()).is_err());
        args["folderId"] = serde_json::Value::Null;
        assert!(serde_json::from_value::<MoveNoteArgs>(args.clone())
            .unwrap()
            .folder_id
            .is_none());
        args["folderId"] = serde_json::json!("work");
        assert_eq!(
            serde_json::from_value::<MoveNoteArgs>(args)
                .unwrap()
                .folder_id
                .as_deref(),
            Some("work")
        );
        let schema = serde_json::to_value(schemars::schema_for!(MoveNoteArgs)).unwrap();
        assert_eq!(
            schema["properties"]["folderId"]["type"],
            serde_json::json!(["string", "null"])
        );
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("folderId")));
    }

    #[tokio::test]
    async fn organization_tools_enforce_independent_permissions_and_validate_inputs() {
        let snapshot = Arc::new(RwLock::new(snapshot()));
        let server = ScratchpadServer::new(snapshot.clone());
        for (operation, args) in [
            (
                "rename_note",
                serde_json::json!({"collectionId":"test-collection", "requestId":"rename-note", "noteId":"one", "expectedRevision":"revision-one", "title":"New title"}),
            ),
            (
                "move_note",
                serde_json::json!({"collectionId":"test-collection", "requestId":"move", "noteId":"one", "expectedRevision":"revision-one", "folderId":null}),
            ),
            (
                "rename_folder",
                serde_json::json!({"collectionId":"test-collection", "requestId":"rename-folder", "folderId":"work", "expectedRevision":"revision-work", "name":"Projects"}),
            ),
        ] {
            assert!(server
                .write(operation, args.clone())
                .await
                .unwrap()
                .is_error
                .unwrap());
            *snapshot.read().unwrap().writes.permissions.write().unwrap() =
                permission_set(vec![operation.into()]).unwrap();
            for other in WRITE_TOOLS {
                assert_eq!(server.is_allowed(other).unwrap(), other == operation);
            }
            let mut invalid = args.clone();
            invalid["expectedRevision"] = serde_json::json!("");
            assert!(server.write(operation, invalid).await.is_err());
            let mut invalid = args.clone();
            invalid[match operation {
                "rename_note" => "title",
                "move_note" => "folderId",
                _ => "name",
            }] = serde_json::json!(" ");
            assert!(server.write(operation, invalid).await.is_err());
            // Valid arguments reach the editor boundary, rather than a validation error.
            let result = server.write(operation, args).await.unwrap();
            assert!(serde_json::to_string(&result)
                .unwrap()
                .contains("editor is unavailable"));
            snapshot
                .read()
                .unwrap()
                .writes
                .permissions
                .write()
                .unwrap()
                .clear();
        }
    }

    #[test]
    fn lists_and_searches_the_live_snapshot_in_sidebar_order() {
        let snapshot = snapshot();
        let folders = list_folders_data(&snapshot, 50, 0);
        assert_eq!(folders.collection_name, "Project notes");
        assert_eq!(folders.folders[0].note_count, 1);
        assert_eq!(folders.folders[0].revision, "revision-work");

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
        assert_eq!(tools.len(), 13);
        for forbidden in ["empty_trash", "purge_trash", "restore_note"] {
            assert!(!tools.iter().any(|tool| tool["name"] == forbidden));
        }
        let move_schema = &tools
            .iter()
            .find(|tool| tool["name"] == "move_note")
            .unwrap()["inputSchema"];
        assert_eq!(
            move_schema["properties"]["folderId"]["type"],
            serde_json::json!(["string", "null"])
        );
        assert!(move_schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("folderId")));
        for tool in tools {
            assert_eq!(
                tool["annotations"]["readOnlyHint"],
                !WRITE_TOOLS.contains(&tool["name"].as_str().unwrap())
            );
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

        assert_eq!(
            note["result"]["structuredContent"]["collectionId"],
            "test-collection"
        );
        // Creation is advertised but must fail closed until the app grants it.
        for (id, name, arguments) in [
            (
                7,
                "create_note",
                serde_json::json!({"collectionId":"test-collection", "requestId":"n1", "title":"New"}),
            ),
            (
                8,
                "create_folder",
                serde_json::json!({"collectionId":"test-collection", "requestId":"f1", "name":"New"}),
            ),
        ] {
            send_json(
                &mut client,
                serde_json::json!({
                    "jsonrpc":"2.0", "id":id, "method":"tools/call",
                    "params":{"name":name,"arguments":arguments}
                }),
            )
            .await;
            let result = receive_json(&mut client).await;
            assert_eq!(result["result"]["isError"], true);
            assert!(result["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("disabled"));
        }
        snapshot
            .read()
            .unwrap()
            .writes
            .permissions
            .write()
            .unwrap()
            .extend(WRITE_TOOLS[..2].iter().map(|s| s.to_string()));
        send_json(&mut client, serde_json::json!({
            "jsonrpc":"2.0", "id":9, "method":"tools/call",
            "params":{"name":"create_note","arguments":{"collectionId":"stale","requestId":"n1","title":"New"}}
        })).await;
        let stale = receive_json(&mut client).await;
        assert_eq!(stale["result"]["isError"], true);
        assert!(stale["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Collection changed"));
        send_json(&mut client, serde_json::json!({
            "jsonrpc":"2.0", "id":10, "method":"tools/call",
            "params":{"name":"create_note","arguments":{"collectionId":"test-collection","requestId":"","title":"New"}}
        })).await;
        assert!(receive_json(&mut client).await["error"].is_object());
        assert_eq!(snapshot.read().unwrap().notes.len(), 2);

        assert_eq!(
            note["result"]["structuredContent"]["revision"],
            "revision-one"
        );
        // Creation permission alone must not authorize modification of a note.
        send_json(&mut client, serde_json::json!({
            "jsonrpc":"2.0", "id":11, "method":"tools/call",
            "params":{"name":"append_to_note","arguments":{"collectionId":"test-collection","requestId":"a1","noteId":"one","expectedRevision":"revision-one","content":" appended"}}
        })).await;
        let denied = receive_json(&mut client).await;
        assert_eq!(denied["result"]["isError"], true);
        assert!(denied["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("disabled"));
        snapshot
            .read()
            .unwrap()
            .writes
            .permissions
            .write()
            .unwrap()
            .insert("append_to_note".into());
        send_json(&mut client, serde_json::json!({
            "jsonrpc":"2.0", "id":12, "method":"tools/call",
            "params":{"name":"append_to_note","arguments":{"collectionId":"test-collection","requestId":"a1","noteId":"one","expectedRevision":"","content":" appended"}}
        })).await;
        assert!(receive_json(&mut client).await["error"].is_object());
        assert_eq!(
            snapshot.read().unwrap().notes[0].content,
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
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 13);
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
    fn mcp_token_path_uses_the_supplied_identifier() {
        let identifier = "io.github.crims0n.scratchpad.beta";
        assert_eq!(
            mcp_token_path(identifier).unwrap(),
            dirs::config_dir()
                .unwrap()
                .join(identifier)
                .join(MCP_TOKEN_FILE_NAME)
        );
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
