// SPDX-License-Identifier: GPL-3.0-or-later
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const JOURNAL: &str = "pending-local-restore.json";

fn sync_directory(_directory: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(_directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn private_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    if let Some(parent) = directory.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn write_new_verified(path: &Path, content: &str) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    if fs::read(path).map_err(|error| error.to_string())? != content.as_bytes() {
        return Err("Backup verification failed".into());
    }
    Ok(())
}

fn validate_backup(content: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|error| error.to_string())?;
    if value["schemaVersion"] != 1
        || value["kind"] != "scratchpad-collection-backup"
        || !value["collection"]["notes"].is_array()
        || !value["collection"]["folders"].is_array()
        || !value["collection"]["trash"].is_array()
    {
        return Err("Not a supported collection backup".into());
    }
    Ok(())
}

pub fn ensure_export_destination(
    path: &Path,
    directory: &Path,
    workspace: Option<&str>,
) -> Result<(), String> {
    let mut protected = vec![directory.join(JOURNAL)];
    if let Some(workspace) = workspace {
        protected.push(PathBuf::from(workspace));
    }
    for source in protected {
        if path == source
            || fs::canonicalize(path)
                .ok()
                .zip(fs::canonicalize(&source).ok())
                .is_some_and(|(destination, original)| destination == original)
        {
            return Err(
                "Choose a backup file, not the open workspace or an active restore checkpoint"
                    .into(),
            );
        }
    }
    Ok(())
}

// Never truncate an existing backup: stage, sync, verify, then replace it.
pub fn export(path: &Path, content: &str) -> Result<(), String> {
    validate_backup(content)?;
    let parent = path.parent().ok_or("Backup path has no parent")?;
    let temporary = parent.join(format!(".scratchpad-backup-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        write_new_verified(&temporary, content)?;
        fs::rename(&temporary, path).map_err(|error| error.to_string())?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn preserve(directory: &Path, content: &str) -> Result<String, String> {
    validate_backup(content)?;
    private_directory(directory)?;
    let path = directory.join(format!("collection-{}.json", uuid::Uuid::new_v4()));
    write_new_verified(&path, content)?;
    sync_directory(directory)?;
    Ok(path.to_string_lossy().into_owned())
}

fn validate_values(values: &serde_json::Value) -> Result<(), String> {
    let keys = ["scratchpad_notes", "scratchpad_folders", "scratchpad_trash"];
    let object = values.as_object().ok_or("Invalid restore checkpoint")?;
    if object.len() != keys.len()
        || keys.iter().any(|key| {
            object
                .get(*key)
                .is_none_or(|value| !value.is_null() && !value.is_string())
        })
    {
        return Err("Invalid restore checkpoint".into());
    }
    Ok(())
}

pub fn begin(directory: &Path, values: serde_json::Value, content: &str) -> Result<String, String> {
    validate_values(&values)?;
    if directory.join(JOURNAL).exists() {
        return Err("An interrupted local restore must be recovered first".into());
    }
    let safety_path = preserve(directory, content)?;
    let journal =
        serde_json::json!({ "schemaVersion": 1, "values": values, "safetyPath": safety_path })
            .to_string();
    // Exclusive creation prevents overwriting an earlier checkpoint. A partial
    // journal is deliberately retained and fails closed on the next launch.
    write_new_verified(&directory.join(JOURNAL), &journal)?;
    sync_directory(directory)?;
    Ok(safety_path)
}

pub fn read(directory: &Path) -> Result<Option<serde_json::Value>, String> {
    let content = match fs::read_to_string(directory.join(JOURNAL)) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let journal: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    if journal["schemaVersion"] != 1 {
        return Err("Unsupported restore checkpoint".into());
    }
    validate_values(&journal["values"])?;
    Ok(Some(journal["values"].clone()))
}

pub fn complete(directory: &Path) -> Result<(), String> {
    fs::remove_file(directory.join(JOURNAL)).map_err(|error| error.to_string())?;
    sync_directory(directory)
}

pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|path| path.join("collection-backups"))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        std::env::temp_dir().join(format!("scratchpad-backup-test-{}", uuid::Uuid::new_v4()))
    }
    fn content() -> String {
        serde_json::json!({"schemaVersion":1,"kind":"scratchpad-collection-backup",
        "collection":{"notes":[],"folders":[],"trash":[]}})
        .to_string()
    }
    fn values() -> serde_json::Value {
        serde_json::json!({"scratchpad_notes":"[]","scratchpad_folders":null,"scratchpad_trash":"[]"})
    }

    #[test]
    fn checkpoint_survives_restart_and_cannot_be_overwritten() {
        let dir = directory();
        assert!(read(&dir).unwrap().is_none());
        let safety = begin(&dir, values(), &content()).unwrap();
        assert_eq!(fs::read_to_string(&safety).unwrap(), content());
        assert_eq!(read(&dir).unwrap(), Some(values()));
        assert!(begin(&dir, values(), &content()).is_err());
        complete(&dir).unwrap();
        assert!(read(&dir).unwrap().is_none());
        assert!(Path::new(&safety).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn bad_checkpoint_and_failed_exports_do_not_replace_existing_data() {
        let dir = directory();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(JOURNAL), "{ truncated").unwrap();
        assert!(read(&dir).is_err());
        assert!(begin(&dir, values(), &content()).is_err());
        let target = dir.join("backup.json");
        fs::write(&target, "existing").unwrap();
        assert!(export(&target, "{}").is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "existing");
        export(&target, &content()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), content());
        assert!(export(&dir.join("missing/backup.json"), &content()).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn safety_copies_preserve_collections_larger_than_the_webview_quota() {
        let dir = directory();
        let content = serde_json::json!({ "schemaVersion": 1, "kind": "scratchpad-collection-backup",
            "createdAt": "2026-10-01T00:00:00Z", "collection": { "notes": [{ "id": "large",
                "title": "Large", "content": "x".repeat(6_000_000), "updatedAt": 1,
                "isPinned": false, "isTitleLocked": true, "folderId": null }], "folders": [], "trash": [] } }).to_string();
        let path = preserve(&dir, &content).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), content);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn export_cannot_overwrite_the_open_workspace_or_restore_checkpoint() {
        let dir = directory();
        fs::create_dir_all(&dir).unwrap();
        let workspace = dir.join("workspace.db");
        fs::write(&workspace, "original database").unwrap();
        fs::write(dir.join(JOURNAL), "original checkpoint").unwrap();
        assert!(ensure_export_destination(&workspace, &dir, workspace.to_str()).is_err());
        assert!(
            ensure_export_destination(&dir.join("./workspace.db"), &dir, workspace.to_str())
                .is_err()
        );
        assert!(ensure_export_destination(&dir.join(JOURNAL), &dir, None).is_err());
        assert!(
            ensure_export_destination(&dir.join("backup.json"), &dir, workspace.to_str()).is_ok()
        );
        assert_eq!(fs::read_to_string(workspace).unwrap(), "original database");
        assert_eq!(
            fs::read_to_string(dir.join(JOURNAL)).unwrap(),
            "original checkpoint"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn safety_copies_and_journals_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = directory();
        let safety = begin(&dir, values(), &content()).unwrap();
        for path in [Path::new(&safety), &dir.join(JOURNAL)] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
