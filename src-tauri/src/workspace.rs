// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn open_connection(
    path: &Path,
    flags: rusqlite::OpenFlags,
) -> Result<rusqlite::Connection, String> {
    #[cfg(unix)]
    let (flags, created) = if flags.contains(rusqlite::OpenFlags::SQLITE_OPEN_CREATE) {
        // Precreate only new files. SQLite's Unix VFS gives new journal/WAL
        // files the database's mode, so there is no per-save permission work.
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
        let created = match options.open(path) {
            Ok(file) => Some(file),
            // A file that appeared after the native choice is existing data:
            // do not truncate it or change its sharing permissions.
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
            Err(error) => return Err(error.to_string()),
        };
        (flags & !rusqlite::OpenFlags::SQLITE_OPEN_CREATE, created)
    } else {
        (flags, None)
    };
    let result =
        rusqlite::Connection::open_with_flags(path, flags).map_err(|error| error.to_string());
    #[cfg(unix)]
    if result.is_err() {
        if let Some(file) = created.as_ref() {
            remove_empty_created_file(path, file);
        }
    }
    result
}

#[cfg(unix)]
fn remove_empty_created_file(path: &Path, file: &std::fs::File) {
    use std::os::unix::fs::MetadataExt;
    // Keep the original inode alive while checking for best-effort cleanup.
    // Discard only an observed empty original, not a replacement or note data.
    if let (Ok(original), Ok(current)) = (file.metadata(), std::fs::symlink_metadata(path)) {
        if current.is_file()
            && current.len() == 0
            && current.dev() == original.dev()
            && current.ino() == original.ino()
        {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[derive(Default)]
struct Grants {
    current: Option<PathBuf>,
    current_decided: bool,
    paths: HashMap<PathBuf, Arc<Mutex<bool>>>,
    // Export protection outlives a read/write grant, so a stale export dialog
    // cannot overwrite a workspace after a switch or disconnect.
    protected: HashSet<PathBuf>,
}

/// Only a native choice or native preference can grant a workspace. During a
/// switch, the current workspace and one pending native choice are available.
#[derive(Default)]
pub(crate) struct Workspaces(Mutex<Grants>);

pub(crate) fn canonical_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute workspace file path".into());
    }
    match dunce::canonicalize(path) {
        Ok(path) if path.is_file() => Ok(path),
        Ok(_) => Err("Choose a workspace file, not a directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if std::fs::symlink_metadata(path).is_ok_and(|entry| entry.is_symlink()) {
                return Err(
                    "Workspace link target is missing; choose the target file directly".into(),
                );
            }
            let parent = path.parent().ok_or("Workspace has no parent directory")?;
            let name = path.file_name().ok_or("Workspace has no file name")?;
            dunce::canonicalize(parent)
                .map(|parent| parent.join(name))
                .map_err(|error| format!("Could not resolve workspace directory: {error}"))
        }
        Err(error) => Err(format!("Could not resolve workspace file: {error}")),
    }
}

impl Workspaces {
    pub(crate) fn authorize(&self, path: &Path, allow_create: bool) -> Result<PathBuf, String> {
        let path = canonical_path(path)?;
        if !allow_create && !path.is_file() {
            return Err("Workspace file is missing; open it again from the Scratchpad menu".into());
        }
        let can_create = allow_create && !path.exists();
        let mut grants = self.0.lock().map_err(|error| error.to_string())?;
        let current = grants.current.clone();
        grants
            .paths
            .retain(|path, _| Some(path) == current.as_ref());
        grants
            .paths
            .entry(path.clone())
            .or_insert_with(|| Arc::new(Mutex::new(can_create)));
        grants.protected.insert(path.clone());
        Ok(path)
    }

    /// Commit the UI's switch before persisting its preference. In particular,
    /// disconnect must revoke access even if the preference write later fails.
    pub(crate) fn set_current(&self, path: Option<&Path>) -> Result<Option<PathBuf>, String> {
        let path = path.map(canonical_path).transpose()?;
        let mut grants = self.0.lock().map_err(|error| error.to_string())?;
        if let Some(path) = &path {
            if !grants.paths.contains_key(path) {
                return Err("This workspace was not chosen in Scratchpad".into());
            }
        }
        grants
            .paths
            .retain(|candidate, _| Some(candidate) == path.as_ref());
        grants.current = path.clone();
        grants.current_decided = true;
        Ok(path)
    }

    /// None means startup has not decided yet; Some(None) means local notes.
    /// Once a switch/disconnect occurs, stale preferences must never regrant a file.
    pub(crate) fn current_decision(&self) -> Result<Option<Option<PathBuf>>, String> {
        let grants = self.0.lock().map_err(|error| error.to_string())?;
        Ok(grants.current_decided.then(|| grants.current.clone()))
    }

    pub(crate) fn ensure_export_destination(&self, path: &Path) -> Result<(), String> {
        let destination = canonical_path(path)?;
        let grants = self.0.lock().map_err(|error| error.to_string())?;
        if grants.protected.contains(&destination) {
            Err("Choose an export file, not a workspace opened in this session".into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn open(&self, path: &str) -> Result<rusqlite::Connection, String> {
        self.open_with(path, open_connection)
    }

    fn open_with(
        &self,
        path: &str,
        open: impl FnOnce(&Path, rusqlite::OpenFlags) -> Result<rusqlite::Connection, String>,
    ) -> Result<rusqlite::Connection, String> {
        let path = canonical_path(Path::new(path))?;
        let creation = self
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .paths
            .get(&path)
            .cloned()
            .ok_or(
                "This workspace was not chosen in Scratchpad. Open it from the Scratchpad menu.",
            )?;
        // Only opens of this same file serialize. Other workspace commands and
        // revocation never wait on SQLite while holding the grants mutex.
        let mut can_create = creation.lock().map_err(|error| error.to_string())?;
        let mut flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE;
        if *can_create {
            flags |= rusqlite::OpenFlags::SQLITE_OPEN_CREATE;
        }
        let connection =
            open(&path, flags).map_err(|error| format!("Could not open workspace: {error}"))?;
        *can_create = false;
        Ok(connection)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> crate::test_support::TestDirectory {
        crate::test_support::TestDirectory::new("grants")
    }

    #[cfg(unix)]
    #[test]
    fn failed_open_cleanup_keeps_written_data_and_replacement_files() {
        let directory = directory();
        let path = directory.join("created.sqlite");
        let original = std::fs::File::create(&path).unwrap();
        std::fs::write(&path, "another writer's data").unwrap();
        remove_empty_created_file(&path, &original);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "another writer's data"
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, "").unwrap();
        remove_empty_created_file(&path, &original);
        assert!(path.is_file(), "an empty replacement is not ours to remove");
    }

    #[cfg(unix)]
    #[test]
    fn new_workspaces_and_sidecars_are_private_but_existing_workspace_modes_are_preserved() {
        use std::os::unix::fs::PermissionsExt;

        for existing in [false, true] {
            for journal_mode in ["PERSIST", "WAL"] {
                let directory = directory();
                let path = directory.join("workspace.sqlite");
                let expected_mode = if existing { 0o640 } else { 0o600 };
                if existing {
                    std::fs::write(&path, "").unwrap();
                    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(expected_mode))
                        .unwrap();
                }
                let workspaces = Workspaces::default();
                workspaces.authorize(&path, !existing).unwrap();
                let connection = workspaces.open(path.to_str().unwrap()).unwrap();
                connection
                    .execute_batch(&format!(
                        "PRAGMA journal_mode={journal_mode};
                         CREATE TABLE test (body TEXT);
                         INSERT INTO test VALUES ('keep this note');"
                    ))
                    .unwrap();
                let suffixes: &[&str] = if journal_mode == "WAL" {
                    &["", "-wal", "-shm"]
                } else {
                    &["", "-journal"]
                };
                for suffix in suffixes {
                    let file = directory.join(format!("workspace.sqlite{suffix}"));
                    assert_eq!(
                        std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                        expected_mode,
                        "unexpected permissions for {}",
                        file.display()
                    );
                }
                drop(connection);
                let reopened = workspaces.open(path.to_str().unwrap()).unwrap();
                let body: String = reopened
                    .query_row("SELECT body FROM test", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(body, "keep this note");
                drop(reopened);
                std::fs::remove_dir_all(directory).unwrap();
            }
        }
    }

    #[test]
    fn a_file_appearing_after_the_native_choice_is_not_truncated_or_restricted() {
        let directory = directory();
        let path = directory.join("appeared.sqlite");
        let workspaces = Workspaces::default();
        workspaces.authorize(&path, true).unwrap();
        let external = rusqlite::Connection::open(&path).unwrap();
        external
            .execute_batch(
                "CREATE TABLE test (body TEXT); INSERT INTO test VALUES ('existing note');",
            )
            .unwrap();
        drop(external);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        }
        let connection = workspaces.open(path.to_str().unwrap()).unwrap();
        let body: String = connection
            .query_row("SELECT body FROM test", [], |row| row.get(0))
            .unwrap();
        assert_eq!(body, "existing note");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o640
            );
        }
        drop(connection);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unchosen_paths_and_sqlite_special_filenames_are_rejected_without_creating_files() {
        let directory = directory();
        let path = directory.join("unchosen.sqlite");
        let workspaces = Workspaces::default();
        for path in [
            path.to_str().unwrap(),
            ":memory:",
            "file:/tmp/unchosen.sqlite?mode=rwc",
            "relative.sqlite",
        ] {
            assert!(workspaces.open(path).is_err());
        }
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn a_new_native_choice_can_be_created_once_but_a_missing_workspace_is_never_recreated() {
        let directory = directory();
        let path = directory.join("chosen.sqlite");
        let workspaces = Workspaces::default();
        assert!(workspaces.authorize(&path, false).is_err());
        workspaces.authorize(&path, true).unwrap();
        drop(workspaces.open(path.to_str().unwrap()).unwrap());
        assert!(path.is_file());
        drop(workspaces.open(path.to_str().unwrap()).unwrap());
        std::fs::remove_file(&path).unwrap();
        assert!(workspaces.open(path.to_str().unwrap()).is_err());
        assert!(!path.exists());
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn switching_and_disconnecting_revoke_old_access_but_keep_export_protection() {
        let directory = directory();
        let workspaces = Workspaces::default();
        let a = workspaces
            .authorize(&directory.join("a.sqlite"), true)
            .unwrap();
        drop(workspaces.open(a.to_str().unwrap()).unwrap());
        workspaces.set_current(Some(&a)).unwrap();
        let b = workspaces
            .authorize(&directory.join("b.sqlite"), true)
            .unwrap();
        drop(workspaces.open(b.to_str().unwrap()).unwrap());
        // The current file remains writable until the switch is committed.
        assert!(workspaces.open(a.to_str().unwrap()).is_ok());
        workspaces.set_current(Some(&b)).unwrap();
        assert!(workspaces.open(a.to_str().unwrap()).is_err());
        assert!(workspaces.open(b.to_str().unwrap()).is_ok());
        workspaces.set_current(None).unwrap();
        for path in [&a, &b] {
            assert!(workspaces.open(path.to_str().unwrap()).is_err());
            assert!(workspaces.ensure_export_destination(path).is_err());
        }
        assert!(workspaces
            .ensure_export_destination(&directory.join("notes.html"))
            .is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn a_new_native_choice_replaces_an_abandoned_pending_choice() {
        let directory = directory();
        let workspaces = Workspaces::default();
        let a = workspaces
            .authorize(&directory.join("a.sqlite"), true)
            .unwrap();
        let b = workspaces
            .authorize(&directory.join("b.sqlite"), true)
            .unwrap();
        assert!(workspaces.open(a.to_str().unwrap()).is_err());
        assert!(!a.exists());
        assert!(workspaces.open(b.to_str().unwrap()).is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn opening_a_workspace_releases_the_grants_lock_and_preserves_creation_after_failure() {
        let directory = directory();
        let workspaces = Workspaces::default();
        let path = workspaces
            .authorize(&directory.join("chosen.sqlite"), true)
            .unwrap();
        let result = workspaces.open_with(path.to_str().unwrap(), |path, flags| {
            assert!(
                workspaces.0.try_lock().is_ok(),
                "SQLite opens must not hold the global grants lock"
            );
            assert!(flags.contains(rusqlite::OpenFlags::SQLITE_OPEN_CREATE));
            // Exercise real file precreation and a real SQLite open error.
            open_connection(path, flags | rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        });
        assert!(result.is_err());
        assert!(!path.exists());
        assert!(workspaces.authorize(&path, false).is_err());
        drop(workspaces.open(path.to_str().unwrap()).unwrap());
        assert!(path.is_file());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_grants_accept_normal_and_verbatim_aliases_but_return_simplified_paths() {
        let directory = directory();
        let path = directory.join("workspace.sqlite");
        std::fs::write(&path, "").unwrap();
        let verbatim = std::fs::canonicalize(&path).unwrap();
        let workspaces = Workspaces::default();
        let granted = workspaces.authorize(&verbatim, false).unwrap();
        assert_eq!(granted, dunce::canonicalize(&path).unwrap());
        assert!(!granted.to_string_lossy().starts_with(r"\\?\"));
        assert!(workspaces.open(verbatim.to_str().unwrap()).is_ok());
        assert!(workspaces.ensure_export_destination(&verbatim).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_resolved_and_cannot_redirect_a_grant_to_another_file() {
        let directory = directory();
        let chosen = directory.join("chosen.sqlite");
        let other = directory.join("other.sqlite");
        let link = directory.join("link.sqlite");
        std::fs::write(&chosen, "").unwrap();
        std::fs::write(&other, "sentinel").unwrap();
        std::os::unix::fs::symlink(&chosen, &link).unwrap();
        let workspaces = Workspaces::default();
        assert_eq!(workspaces.authorize(&link, false).unwrap(), chosen);
        assert!(workspaces.open(link.to_str().unwrap()).is_ok());
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&other, &link).unwrap();
        assert!(workspaces.open(link.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "sentinel");
        std::fs::remove_file(&link).unwrap();
        let missing = directory.join("missing.sqlite");
        std::os::unix::fs::symlink(&missing, &link).unwrap();
        assert!(canonical_path(&link)
            .unwrap_err()
            .contains("link target is missing"));
        assert!(workspaces.authorize(&link, true).is_err());
        assert!(!missing.exists(), "choose the intended new file directly");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
