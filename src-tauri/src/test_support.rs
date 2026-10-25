// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::{Path, PathBuf};

pub(crate) struct TestDirectory(PathBuf);

impl TestDirectory {
    pub(crate) fn new(label: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("scratchpad-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
}

impl std::ops::Deref for TestDirectory {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.0
    }
}

impl AsRef<Path> for TestDirectory {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
