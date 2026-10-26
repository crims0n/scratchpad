// SPDX-License-Identifier: GPL-3.0-or-later

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};
use std::sync::OnceLock;
use tauri::Manager;

static REQUEST_CLOSE: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

// AppKit's predefined Quit/Cmd-Q and Dock Quit call terminate: directly, which
// bypasses Tauri's window CloseRequested and RunEvent::ExitRequested. Cancel
// that synchronous termination and ask the main window to close instead. Its
// frontend waits for saves, rejects busy collection operations, and destroys
// main only on success; main's Destroyed handler then exits the application.
extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: &AnyObject) -> usize {
    if let Some(request_close) = REQUEST_CLOSE.get() {
        request_close();
    }
    0 // NSTerminateCancel: do not enter AppKit's modal termination run loop.
}

fn install_on_class(class: &AnyClass) -> Result<(), String> {
    let selector = sel!(applicationShouldTerminate:);
    // Never replace runtime behavior silently if a later Tauri/tao version
    // implements this callback. Review its integration before upgrading.
    if class.instance_method(selector).is_some() {
        return Err("The macOS runtime already handles applicationShouldTerminate:".into());
    }
    // SAFETY: this runs once on the main thread before user events. We add one
    // previously absent method, leaving the runtime delegate and all its ivars
    // and existing methods intact. The ABI is NSUInteger(id, SEL, id), encoded
    // as Q@:@ on supported 64-bit macOS targets. Imp erases the typed signature;
    // AppKit restores it when dispatching applicationShouldTerminate:.
    let installed = unsafe {
        let callback = std::mem::transmute::<
            extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize,
            Imp,
        >(should_terminate);
        objc2::ffi::class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            selector,
            callback,
            c"Q@:@".as_ptr(),
        )
    };
    if !installed.as_bool() {
        return Err("Could not install macOS save-before-quit protection".into());
    }
    Ok(())
}

pub(crate) fn install(app: &tauri::AppHandle) -> Result<(), String> {
    // SAFETY: Tauri calls setup on the macOS main thread, after creating its
    // application/delegate. Both objects outlive this call; we only borrow the
    // delegate to register a method and do not replace or retain either object.
    let delegate = unsafe {
        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![application, delegate];
        delegate
            .as_ref()
            .ok_or("The macOS application has no delegate")?
    };
    let app = app.clone();
    REQUEST_CLOSE
        .set(Box::new(move || {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.close() {
                    eprintln!("Could not request saving before quitting Scratchpad: {error}");
                }
            }
        }))
        .map_err(|_| "macOS save-before-quit protection was already initialized")?;
    install_on_class(delegate.class())
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::ClassBuilder;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn native_termination_dispatch_cancels_and_requests_close_on_every_attempt() {
        let requests = Arc::new(AtomicUsize::new(0));
        let count = requests.clone();
        assert!(REQUEST_CLOSE
            .set(Box::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
            }))
            .is_ok());
        let class = ClassBuilder::new(c"ScratchpadQuitTestDelegate", class!(NSObject))
            .unwrap()
            .register();
        install_on_class(class).unwrap();
        assert!(
            install_on_class(class).is_err(),
            "never overwrite an existing callback"
        );
        // SAFETY: this NSObject subclass has no added ivars and inherits new.
        // The installed selector has the declared AppKit method signature.
        unsafe {
            let delegate: Retained<AnyObject> = msg_send![class, new];
            for expected in 1..=2 {
                let reply: usize = msg_send![&*delegate, applicationShouldTerminate: &*delegate];
                assert_eq!(reply, 0, "AppKit must not terminate before saves finish");
                assert_eq!(requests.load(Ordering::SeqCst), expected);
            }
        }
    }
}
