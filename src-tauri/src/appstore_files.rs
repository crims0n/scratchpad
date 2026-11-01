// SPDX-License-Identifier: GPL-3.0-or-later

use objc2::rc::autoreleasepool;
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use std::ffi::{c_char, CStr, CString};
use std::path::{Path, PathBuf};

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
