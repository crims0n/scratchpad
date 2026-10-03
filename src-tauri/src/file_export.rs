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
        return Err("Export verification failed".into());
    }
    Ok(())
}

// Stage on the same filesystem. Until the verified file is renamed, failures
// leave the existing destination unchanged. Never fall back to truncating it.
pub(crate) fn export(path: &Path, content: &str) -> Result<(), String> {
    export_with(path, content, write_new_verified)
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
