// SPDX-License-Identifier: GPL-3.0-or-later

use block2::RcBlock;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{class, define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{
    NSData, NSError, NSFileCoordinator, NSFileCoordinatorWritingOptions, NSFilePresenter,
    NSOperationQueue, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
    NSURL,
};
use std::collections::HashSet;
use std::ffi::{c_char, CStr, CString};
use std::fs;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::Mutex;

const ITEM_REPLACEMENT_DIRECTORY: usize = 99;
const USER_DOMAIN_MASK: usize = 1;

// App Sandbox grants only the file the user chose, so its folder cannot hold a
// staging file. Foundation creates this unique directory on the destination's
// volume, where a rename stays atomic. The caller removes it when finished.
pub(crate) fn item_replacement_directory(destination: &Path) -> Result<PathBuf, String> {
    const UNAVAILABLE: &str = "Could not prepare a temporary export location";
    let parent = destination.parent().ok_or("Export path has no parent")?;
    let parent = CString::new(parent.to_str().ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE)?;
    autoreleasepool(|_| {
        // SAFETY: these are documented Foundation class and instance methods.
        // Each returned object is autoreleased and is only used inside this
        // pool, and every result is checked for nil before it is used.
        unsafe {
            let parent: *mut AnyObject =
                msg_send![class!(NSString), stringWithUTF8String: parent.as_ptr()];
            if parent.is_null() {
                return Err(UNAVAILABLE.to_string());
            }
            let parent: *mut AnyObject =
                msg_send![class!(NSURL), fileURLWithPath: parent, isDirectory: Bool::YES];
            let manager: *mut AnyObject = msg_send![class!(NSFileManager), defaultManager];
            let directory: *mut AnyObject = msg_send![
                manager,
                URLForDirectory: ITEM_REPLACEMENT_DIRECTORY,
                inDomain: USER_DOMAIN_MASK,
                appropriateForURL: parent,
                create: Bool::YES,
                error: std::ptr::null_mut::<*mut AnyObject>()
            ];
            if directory.is_null() {
                return Err(UNAVAILABLE.to_string());
            }
            let path: *mut AnyObject = msg_send![directory, path];
            let path: *const c_char = msg_send![path, UTF8String];
            if path.is_null() {
                return Err(UNAVAILABLE.to_string());
            }
            CStr::from_ptr(path)
                .to_str()
                .map(PathBuf::from)
                .map_err(|_| UNAVAILABLE.to_string())
        }
    })
}

const SQLITE_SIDECAR_SUFFIXES: [&str; 3] = ["-journal", "-wal", "-shm"];

struct PresentedItem {
    database: Retained<NSURL>,
    sidecar: Retained<NSURL>,
    queue: Retained<NSOperationQueue>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "ScratchpadSqliteSidecarPresenter"]
    #[ivars = PresentedItem]
    struct SidecarPresenter;

    unsafe impl NSObjectProtocol for SidecarPresenter {}

    unsafe impl NSFilePresenter for SidecarPresenter {
        #[unsafe(method_id(primaryPresentedItemURL))]
        fn primary_presented_item_url(&self) -> Option<Retained<NSURL>> {
            Some(self.ivars().database.clone())
        }

        #[unsafe(method_id(presentedItemURL))]
        fn presented_item_url(&self) -> Option<Retained<NSURL>> {
            Some(self.ivars().sidecar.clone())
        }

        #[unsafe(method_id(presentedItemOperationQueue))]
        fn presented_item_operation_queue(&self) -> Retained<NSOperationQueue> {
            self.ivars().queue.clone()
        }
    }
);

static PRESENTED_DATABASES: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

// App Sandbox also denies SQLite's journal and WAL files beside a chosen
// workspace. A presenter for each one, plus one coordinated write, extends the
// grant to that sidecar for the rest of the process, so SQLite's own file calls
// need no further coordination. This relies on NSIsRelatedItemType in
// Info.appstore.plist. A grant cannot be narrowed later, so presenters stay
// registered, and each database registers only once.
pub(crate) fn allow_sqlite_sidecars(database: &Path) -> Result<(), String> {
    const UNAVAILABLE: &str = "Could not prepare workspace access";
    let path = database.to_str().ok_or(UNAVAILABLE)?;
    let mut presented = PRESENTED_DATABASES
        .lock()
        .map_err(|error| error.to_string())?;
    let presented = presented.get_or_insert_with(HashSet::new);
    if presented.contains(database) {
        return Ok(());
    }
    autoreleasepool(|_| {
        let database_url = NSURL::fileURLWithPath(&NSString::from_str(path));
        for suffix in SQLITE_SIDECAR_SUFFIXES {
            let sidecar = NSString::from_str(&format!("{path}{suffix}"));
            let presenter = SidecarPresenter::alloc().set_ivars(PresentedItem {
                database: database_url.clone(),
                sidecar: NSURL::fileURLWithPath(&sidecar),
                queue: NSOperationQueue::new(),
            });
            // SAFETY: NSObject's init takes no arguments and the ivars are set.
            let presenter: Retained<SidecarPresenter> =
                unsafe { msg_send![super(presenter), init] };
            let protocol = ProtocolObject::<dyn NSFilePresenter>::from_ref(&*presenter);
            let accessor = RcBlock::new(|_: NonNull<NSURL>| {});
            let mut error: Option<Retained<NSError>> = None;
            NSFileCoordinator::addFilePresenter(protocol);
            NSFileCoordinator::initWithFilePresenter(NSFileCoordinator::alloc(), Some(protocol))
                .coordinateWritingItemAtURL_options_error_byAccessor(
                    &presenter.ivars().sidecar,
                    NSFileCoordinatorWritingOptions::empty(),
                    Some(&mut error),
                    &accessor,
                );
            // File coordination keeps using a registered presenter.
            std::mem::forget(presenter);
            if error.is_some() {
                return Err(UNAVAILABLE.to_string());
            }
        }
        Ok(())
    })?;
    presented.insert(database.to_path_buf());
    Ok(())
}

fn create_workspace_bookmark(workspace: &Path) -> Result<Vec<u8>, String> {
    const UNAVAILABLE: &str = "Could not remember access to this workspace";
    let path = workspace.to_str().ok_or(UNAVAILABLE)?;
    autoreleasepool(|_| {
        NSURL::fileURLWithPath(&NSString::from_str(path))
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .map(|bookmark| bookmark.to_vec())
            .map_err(|_| UNAVAILABLE.to_string())
    })
}

fn encode_bookmark(data: &[u8]) -> String {
    data.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_bookmark(text: &str) -> Option<Vec<u8>> {
    (0..text.len())
        .step_by(2)
        .map(|start| u8::from_str_radix(text.get(start..start + 2)?, 16).ok())
        .collect()
}

// A path alone cannot regain sandbox access after a relaunch. The bookmark
// lives beside the preferences, so the shared preferences format is unchanged.
// It is the only way back to the workspace, so it is replaced atomically.
pub(crate) fn save_workspace_bookmark(
    bookmark: &Path,
    workspace: Option<&Path>,
) -> Result<(), String> {
    match workspace {
        Some(workspace) => crate::file_export::export(
            bookmark,
            &encode_bookmark(&create_workspace_bookmark(workspace)?),
        ),
        None => match fs::remove_file(bookmark) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        },
    }
}

// Returns the workspace's current path with access restored for the rest of
// the process, or None so the caller falls back to its saved path. Access is
// never released, matching the sidecar presenters that depend on it.
pub(crate) fn restore_workspace_bookmark(bookmark: &Path) -> Option<PathBuf> {
    let data = decode_bookmark(&fs::read_to_string(bookmark).ok()?)?;
    let (path, stale) = autoreleasepool(|_| {
        let mut stale = Bool::NO;
        // SAFETY: `stale` outlives the call, and resolving only reads the data.
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &NSData::with_bytes(&data),
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                &mut stale,
            )
        }
        .ok()?;
        // SAFETY: the URL was just resolved and is not used by another thread.
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return None;
        }
        Some((PathBuf::from(url.path()?.to_string()), stale.as_bool()))
    })?;
    if stale {
        // Access is already restored, and a failed refresh keeps the previous
        // bookmark, so the next launch can try again.
        let _ = save_workspace_bookmark(bookmark, Some(&path));
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Run by the test below in a child process with a one-block file size limit.
    #[test]
    #[ignore = "helper for failed_bookmark_refresh_keeps_the_previous_bookmark"]
    fn restore_bookmark_with_a_file_size_limit() {
        let bookmark = std::env::var_os("SCRATCHPAD_TEST_BOOKMARK").unwrap();
        assert!(restore_workspace_bookmark(Path::new(&bookmark)).is_some());
    }

    #[test]
    fn failed_bookmark_refresh_keeps_the_previous_bookmark() {
        let directory = crate::test_support::TestDirectory::new("bookmark-refresh");
        let bookmark = directory.join("workspace.bookmark");
        let workspace = directory.join("workspace.db");
        fs::write(&workspace, "workspace").unwrap();
        let workspace = fs::canonicalize(workspace).unwrap();
        save_workspace_bookmark(&bookmark, Some(&workspace)).unwrap();
        let moved = workspace.with_file_name("moved.db");
        fs::rename(&workspace, &moved).unwrap();
        let saved = fs::read(&bookmark).unwrap();
        assert!(saved.len() > 512);

        // Ignoring SIGXFSZ turns the limit into an ordinary failed write.
        let status = std::process::Command::new("/bin/sh")
            .args([
                "-c",
                "trap '' XFSZ; ulimit -f 1; exec \"$0\" --ignored --exact \
                 appstore_files::tests::restore_bookmark_with_a_file_size_limit",
            ])
            .arg(std::env::current_exe().unwrap())
            .env("SCRATCHPAD_TEST_BOOKMARK", &bookmark)
            .status()
            .unwrap();
        assert!(status.success());

        assert_eq!(fs::read(&bookmark).unwrap(), saved);
        assert_eq!(restore_workspace_bookmark(&bookmark), Some(moved));
    }

    #[test]
    fn workspace_bookmarks_follow_a_moved_file_and_are_removed_with_the_workspace() {
        let directory = crate::test_support::TestDirectory::new("bookmark");
        let bookmark = directory.join("workspace.bookmark");
        let workspace = directory.join("workspace.db");
        fs::write(&workspace, "workspace").unwrap();
        let workspace = fs::canonicalize(workspace).unwrap();

        assert_eq!(restore_workspace_bookmark(&bookmark), None);
        save_workspace_bookmark(&bookmark, Some(&workspace)).unwrap();
        assert_eq!(
            restore_workspace_bookmark(&bookmark).as_ref(),
            Some(&workspace)
        );

        let moved = workspace.with_file_name("moved.db");
        fs::rename(&workspace, &moved).unwrap();
        assert_eq!(restore_workspace_bookmark(&bookmark).as_ref(), Some(&moved));

        fs::write(&bookmark, "not a bookmark").unwrap();
        assert_eq!(restore_workspace_bookmark(&bookmark), None);

        save_workspace_bookmark(&bookmark, None).unwrap();
        assert!(!bookmark.exists());
        save_workspace_bookmark(&bookmark, None).unwrap();
    }
}
