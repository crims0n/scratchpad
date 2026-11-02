// SPDX-License-Identifier: GPL-3.0-or-later

use block2::RcBlock;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{class, define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{
    NSError, NSFileCoordinator, NSFileCoordinatorWritingOptions, NSFilePresenter, NSOperationQueue,
    NSString, NSURL,
};
use std::collections::HashSet;
use std::ffi::{c_char, CStr, CString};
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
