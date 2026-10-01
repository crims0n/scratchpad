// SPDX-License-Identifier: GPL-3.0-or-later

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn copy_paths(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(format!("Could not list recovery copies: {error}")),
    };
    let mut paths = vec![];
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not list recovery copies: {error}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("recovery-")
            && name.ends_with(".json")
            && entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
        {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn has_copies(directory: &Path) -> Result<bool, String> {
    Ok(!copy_paths(directory)?.is_empty())
}

pub fn read_copies(directory: &Path) -> Result<Vec<String>, String> {
    copy_paths(directory)?
        .into_iter()
        .map(|path| {
            fs::read_to_string(&path).map_err(|error| {
                format!("Could not read recovery copy {}: {error}", path.display())
            })
        })
        .collect()
}

pub fn save_copy(directory: &Path, content: &str) -> Result<String, String> {
    let snapshot: serde_json::Value = serde_json::from_str(content)
        .map_err(|error| format!("Invalid recovery snapshot: {error}"))?;
    if snapshot["schemaVersion"] != 1
        || snapshot["kind"] != "scratchpad-local-recovery"
        || !snapshot["values"].is_object()
    {
        return Err("Invalid recovery snapshot".into());
    }
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create recovery directory: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Could not protect recovery directory: {error}"))?;
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let name = format!("recovery-{timestamp:039}-{}", uuid::Uuid::new_v4());
    let temporary = directory.join(format!("{name}.tmp"));
    let destination = directory.join(format!("{name}.json"));
    let result: Result<String, String> = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        let verified = fs::read(&temporary).map_err(|error| error.to_string())?;
        if verified != content.as_bytes() {
            return Err("Recovery copy verification failed".into());
        }
        fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        fs::File::open(directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
        Ok(destination.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        // An incomplete temporary file is never offered as a recovery copy.
        // A finalized copy is retained even if the subsequent directory sync fails.
        let _ = fs::remove_file(temporary);
    }
    result.map_err(|error| format!("Could not preserve recovery copy: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory() -> PathBuf {
        std::env::temp_dir().join(format!("scratchpad-recovery-test-{}", uuid::Uuid::new_v4()))
    }

    fn snapshot(raw: &str) -> String {
        serde_json::json!({ "schemaVersion": 1, "kind": "scratchpad-local-recovery",
            "values": { "scratchpad_notes": raw } })
        .to_string()
    }

    #[test]
    fn copies_are_independent_verified_files_and_survive_reload() {
        let directory = test_directory();
        assert!(!has_copies(&directory).unwrap());
        assert!(read_copies(&directory).unwrap().is_empty());
        let first = snapshot(&format!("{{ valuable {}", "\"".repeat(1_100_000)));
        let first_path = save_copy(&directory, &first).unwrap();
        let second = snapshot("{ another broken collection");
        let second_path = save_copy(&directory, &second).unwrap();
        assert_ne!(first_path, second_path);
        assert_eq!(fs::read_to_string(first_path).unwrap(), first);
        assert_eq!(fs::read_to_string(second_path).unwrap(), second);
        assert_eq!(read_copies(&directory).unwrap(), vec![first, second]);
        assert!(has_copies(&directory).unwrap());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_snapshots_and_unwritable_destinations_fail_without_final_copies() {
        let directory = test_directory();
        assert!(save_copy(&directory, "{}").is_err());
        assert!(!directory.exists());
        fs::write(&directory, "not a directory").unwrap();
        assert!(save_copy(&directory, &snapshot("{ source")).is_err());
        assert_eq!(fs::read_to_string(&directory).unwrap(), "not a directory");
        fs::remove_file(directory).unwrap();
    }

    #[test]
    fn unfinished_copies_are_not_exported() {
        let directory = test_directory();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("recovery-interrupted.tmp"), "partial").unwrap();
        assert!(!has_copies(&directory).unwrap());
        assert!(read_copies(&directory).unwrap().is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn recovery_copies_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let directory = test_directory();
        let path = save_copy(&directory, &snapshot("{ private data")).unwrap();
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
