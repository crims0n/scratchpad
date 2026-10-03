// SPDX-License-Identifier: GPL-3.0-or-later

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

pub(crate) fn sync_directory(_directory: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(_directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn write_new_verified(path: &Path, content: &str) -> Result<(), String> {
    write_new_verified_with_permissions(path, content, 0o600, None)
}

fn write_new_verified_with_permissions(
    path: &Path,
    content: &str,
    _creation_mode: u32,
    _existing_mode: Option<u32>,
) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(_creation_mode);
    }
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    if fs::read(path).map_err(|error| error.to_string())? != content.as_bytes() {
        return Err("Export verification failed".into());
    }
    // Verify while staging is readable, before restoring a write-only mode.
    #[cfg(unix)]
    if let Some(mode) = _existing_mode {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(mode))
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    drop(file);
    Ok(())
}

// Stage on the same filesystem. Until the verified file is renamed, failures
// leave the existing destination unchanged. Never fall back to truncating it.
pub(crate) fn export(path: &Path, content: &str) -> Result<(), String> {
    export_with(path, content, write_new_verified)
}

// Note exports follow the normal umask for new files. Preserve permission bits
// of an existing regular file; a symlink is replaced, never followed here.
pub(crate) fn export_note(path: &Path, content: &str) -> Result<(), String> {
    #[cfg(unix)]
    let existing_mode = {
        use std::os::unix::fs::PermissionsExt;
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_file() => Some(metadata.permissions().mode() & 0o777),
            Ok(_) => None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        }
    };
    #[cfg(not(unix))]
    let existing_mode = None;
    export_with(path, content, |temporary, content| {
        write_new_verified_with_permissions(
            temporary,
            content,
            if existing_mode.is_some() {
                0o600
            } else {
                0o666
            },
            existing_mode,
        )
    })
}

fn export_with(
    path: &Path,
    content: &str,
    stage: impl FnOnce(&Path, &str) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("Export path has no parent")?;
    let temporary = parent.join(format!(".scratchpad-export-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        stage(&temporary, content)?;
        fs::rename(&temporary, path).map_err(|error| error.to_string())?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn note_exports_respect_umask_and_existing_modes_while_private_exports_stay_private() {
        use std::os::unix::fs::PermissionsExt;
        let directory =
            std::env::temp_dir().join(format!("scratchpad-modes-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let reference = directory.join("ordinary-file");
        fs::write(&reference, "reference").unwrap();
        let normal_mode = fs::metadata(&reference).unwrap().permissions().mode() & 0o777;
        for extension in ["html", "md"] {
            let target = directory.join(format!("note.{extension}"));
            export_note(&target, "note").unwrap();
            assert_eq!(
                fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                normal_mode
            );
            for mode in [0o640, 0o400, 0o200] {
                fs::set_permissions(&target, fs::Permissions::from_mode(mode)).unwrap();
                export_note(&target, "updated note").unwrap();
                assert_eq!(
                    fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                    mode
                );
            }
        }
        export(&reference, "private recovery or backup").unwrap();
        assert_eq!(
            fs::metadata(&reference).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn note_export_replaces_a_symlink_and_keeps_its_original_target_unchanged() {
        use std::os::unix::fs::symlink;
        let directory =
            std::env::temp_dir().join(format!("scratchpad-symlink-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let target = directory.join("original.md");
        let link = directory.join("export.md");
        fs::write(&target, "original target").unwrap();
        symlink(&target, &link).unwrap();
        export_note(&link, "exported note").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().is_file());
        assert_eq!(fs::read_to_string(link).unwrap(), "exported note");
        assert_eq!(fs::read_to_string(target).unwrap(), "original target");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn staging_failures_preserve_existing_exports_and_remove_partial_files() {
        let directory =
            std::env::temp_dir().join(format!("scratchpad-export-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        for extension in ["html", "md", "json"] {
            let target = directory.join(format!("note.{extension}"));
            fs::write(&target, "existing destination").unwrap();
            for failure in ["write", "sync", "verification"] {
                assert!(export_with(&target, "new content", |temporary, _| {
                    fs::write(temporary, "partial content").unwrap();
                    Err(format!("simulated {failure} failure"))
                })
                .is_err());
                assert_eq!(fs::read_to_string(&target).unwrap(), "existing destination");
                assert!(!fs::read_dir(&directory).unwrap().any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")));
            }
            export(&target, "Résumé 日本語\nnew content").unwrap();
            assert_eq!(
                fs::read_to_string(&target).unwrap(),
                "Résumé 日本語\nnew content"
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_publication_preserves_destination_and_removes_staging_file() {
        let directory =
            std::env::temp_dir().join(format!("scratchpad-export-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let target = directory.join("destination");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("sentinel"), "existing data").unwrap();
        assert!(export(&target, "new content").is_err());
        assert_eq!(
            fs::read_to_string(target.join("sentinel")).unwrap(),
            "existing data"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
