// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Only native choices and native preferences may authorize workspace files.
/// The boolean permits the first creation of a newly chosen workspace, never
/// recreation of a remembered workspace that has gone missing.
#[derive(Default)]
pub(crate) struct Workspaces(Mutex<HashMap<PathBuf, bool>>);

fn canonical_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute workspace file path".into());
    }
    match path.canonicalize() {
        Ok(path) if path.is_file() => Ok(path),
        Ok(_) => Err("Choose a workspace file, not a directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or("Workspace has no parent directory")?;
            let name = path.file_name().ok_or("Workspace has no file name")?;
            parent
                .canonicalize()
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
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .insert(path.clone(), can_create);
        Ok(path)
    }

    pub(crate) fn require(&self, path: &Path) -> Result<PathBuf, String> {
        let path = canonical_path(path)?;
        if self
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(&path)
        {
            Ok(path)
        } else {
            Err(
                "This workspace was not chosen in Scratchpad. Open it from the Scratchpad menu."
                    .into(),
            )
        }
    }

    pub(crate) fn open(&self, path: &str) -> Result<rusqlite::Connection, String> {
        let path = self.require(Path::new(path))?;
        let mut paths = self.0.lock().map_err(|error| error.to_string())?;
        let can_create = paths.get_mut(&path).ok_or("Workspace is not authorized")?;
        // URI filenames are intentionally disabled, even if supplied by IPC.
        let mut flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE;
        if *can_create {
            flags |= rusqlite::OpenFlags::SQLITE_OPEN_CREATE;
        }
        let connection = rusqlite::Connection::open_with_flags(&path, flags)
            .map_err(|error| format!("Could not open workspace: {error}"))?;
        *can_create = false;
        Ok(connection)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("scratchpad-grants-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        path.canonicalize().unwrap()
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
        assert!(workspaces.require(&link).is_ok());
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&other, &link).unwrap();
        assert!(workspaces.open(link.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "sentinel");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
