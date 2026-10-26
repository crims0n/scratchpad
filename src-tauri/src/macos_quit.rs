// SPDX-License-Identifier: GPL-3.0-or-later

use dispatch2::{DispatchQueue, DispatchTime};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, NSObject, Sel};
use objc2::{class, define_class, msg_send, sel, AnyThread, DefinedClass};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

const NOW: usize = 1;
const LATER: usize = 2;
const QUIT_REQUEST: &str = "scratchpad-native-quit";
const QUIT_CANCELLED: &str = "scratchpad-native-quit-cancelled";
const QUIT_TIMEOUT: Duration = Duration::from_secs(30);
// An association key, not a process-wide callback: each delegate owns its bridge.
static BRIDGE_KEY: u8 = 0;

#[derive(Default)]
pub(crate) struct QuitState(Mutex<Option<PendingQuit>>);

struct PendingQuit {
    id: String,
    claimed: bool,
}

impl QuitState {
    fn begin(&self, has_main: bool) -> (usize, Option<String>) {
        if !has_main {
            return (NOW, None);
        }
        let mut pending = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if pending.is_some() {
            return (LATER, None);
        }
        let id = uuid::Uuid::new_v4().to_string();
        *pending = Some(PendingQuit {
            id: id.clone(),
            claimed: false,
        });
        (LATER, Some(id))
    }

    fn pending(&self, id: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|pending| pending.id == id && !pending.claimed)
    }

    fn current(&self) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .map(|pending| pending.id.clone())
    }

    fn claim(&self, id: &str) -> bool {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let Some(pending) = state.as_mut() else {
            return false;
        };
        if pending.id != id || pending.claimed {
            return false;
        }
        pending.claimed = true;
        true
    }

    fn finish(&self, id: &str) -> bool {
        let mut pending = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if !pending.as_ref().is_some_and(|pending| pending.id == id) {
            return false;
        }
        *pending = None;
        true
    }
}

struct Bridge {
    state: Arc<QuitState>,
    has_main: Box<dyn Fn() -> bool + Send + Sync>,
    request: Box<dyn Fn(String) + Send + Sync>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "ScratchpadQuitBridge"]
    #[ivars = Bridge]
    struct QuitBridge;
);

impl QuitBridge {
    fn new(bridge: Bridge) -> Retained<Self> {
        let this = Self::alloc().set_ivars(bridge);
        // SAFETY: NSObject's initializer is inherited; Rust ivars are initialized.
        unsafe { msg_send![super(this), init] }
    }
}

extern "C-unwind" fn should_terminate(delegate: &AnyObject, _: Sel, _: &AnyObject) -> usize {
    // SAFETY: only attach_bridge writes this private association key, retaining
    // a QuitBridge for the delegate's lifetime. AppKit calls us on the main thread.
    let bridge = unsafe {
        objc2::ffi::objc_getAssociatedObject(delegate, &BRIDGE_KEY as *const u8 as _)
            .cast::<QuitBridge>()
            .as_ref()
    };
    let Some(bridge) = bridge else { return NOW };
    let bridge = bridge.ivars();
    let (reply, request) = bridge.state.begin((bridge.has_main)());
    if let Some(id) = request {
        // The production closure only queues work. Do not re-enter Tauri from
        // inside AppKit's terminate: dispatch (run_on_main_thread can run inline).
        (bridge.request)(id);
    }
    reply
}

fn install_on_class(class: &AnyClass) -> Result<(), String> {
    let selector = sel!(applicationShouldTerminate:);
    let callback = should_terminate as extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize;
    // SAFETY: Imp erases the method signature; Q@:@ is NSUInteger(id, SEL, id)
    // on supported 64-bit macOS targets. No delegate ivars/methods are replaced.
    let callback = unsafe {
        std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize, Imp>(
            callback,
        )
    };
    if let Some(existing) = class.instance_method(selector) {
        return if std::ptr::fn_addr_eq(existing.implementation(), callback) {
            Ok(())
        } else {
            Err("The macOS runtime already handles applicationShouldTerminate:".into())
        };
    }
    // SAFETY: setup runs on the main thread before user interaction. The new
    // method uses the exact AppKit signature and leaves all existing behavior intact.
    let installed = unsafe {
        objc2::ffi::class_addMethod(
            class as *const _ as *mut _,
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

fn attach_bridge(delegate: &AnyObject, bridge: Bridge) -> Result<(), String> {
    install_on_class(delegate.class())?;
    let bridge = QuitBridge::new(bridge);
    // SAFETY: the runtime retains our bridge and releases it with the delegate.
    // Its Rust ivars are dropped by define_class; no raw Rust pointer is stored.
    unsafe {
        objc2::ffi::objc_setAssociatedObject(
            delegate as *const _ as *mut _,
            &BRIDGE_KEY as *const u8 as _,
            Retained::as_ptr(&bridge) as *mut AnyObject,
            objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
        );
    }
    Ok(())
}

fn reply_to_appkit(saved: bool) {
    // SAFETY: callers dispatch asynchronously to the main queue. NSTerminateLater
    // requires exactly one BOOL reply; QuitState rejects stale/duplicate replies.
    unsafe {
        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![application, replyToApplicationShouldTerminate: Bool::new(saved)];
    }
}

pub(crate) fn complete<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    saved: bool,
) -> bool {
    let Some(state) = app.try_state::<Arc<QuitState>>() else {
        return false;
    };
    if !state.claim(id) {
        return false;
    }
    let state = state.inner().clone();
    let app = app.clone();
    let id = id.to_string();
    DispatchQueue::main().exec_async(move || {
        if !state.finish(&id) {
            return;
        }
        if !saved {
            let _ = app.emit_to("main", QUIT_CANCELLED, &id);
        }
        // YES resumes the original quit/logout/restart/shutdown request. NO is
        // reserved for failed saves, busy operations or the user's Keep Open choice.
        reply_to_appkit(saved);
    });
    true
}

pub(crate) fn main_window_destroyed(app: &tauri::AppHandle) -> bool {
    let Some(state) = app.try_state::<Arc<QuitState>>() else {
        return false;
    };
    let Some(id) = state.current() else {
        return false;
    };
    // A normal window close may have already finished saving when AppKit asks
    // to terminate. Resume that system request instead of exiting around it.
    complete(app, &id, true);
    true
}

fn timeout(app: &tauri::AppHandle, state: &QuitState, id: &str) {
    if !state.pending(id) {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        complete(app, id, true);
        return;
    };
    // This native choice remains available when the renderer never loads or a
    // save promise never resolves. A timeout alone must never discard edits.
    let choice = rfd::MessageDialog::new()
        // On macOS an unparented rfd dialog uses a blocking system notification.
        // A window parent selects NSAlert, which keeps AppKit's modal loop live.
        .set_parent(&window)
        .set_title("Scratchpad has not finished saving")
        .set_description("Scratchpad has not confirmed that your latest edits were saved. Keep the app open to wait or recover your work, or quit without saving. Unsaved changes may be lost if you quit.")
        .set_buttons(rfd::MessageButtons::YesNoCancelCustom("Keep Open".into(), "Quit Without Saving".into(), "Cancel".into()))
        .show();
    complete(app, id, chose_quit_without_saving(&choice));
}

fn chose_quit_without_saving(choice: &rfd::MessageDialogResult) -> bool {
    matches!(choice, rfd::MessageDialogResult::Custom(label) if label == "Quit Without Saving")
        || *choice == rfd::MessageDialogResult::No
}

pub(crate) fn install(app: &tauri::AppHandle) -> Result<(), String> {
    // SAFETY: Tauri setup runs on the main thread after creating its delegate.
    let delegate = unsafe {
        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![application, delegate];
        delegate
            .as_ref()
            .ok_or("The macOS application has no delegate")?
    };
    let state = app
        .try_state::<Arc<QuitState>>()
        .map(|state| state.inner().clone())
        .unwrap_or_else(|| Arc::new(QuitState::default()));
    let has_main = app.clone();
    let request = app.clone();
    let pending = state.clone();
    attach_bridge(
        delegate,
        Bridge {
            state: state.clone(),
            has_main: Box::new(move || has_main.get_webview_window("main").is_some()),
            request: Box::new(move |id| {
                let app = request.clone();
                let state = pending.clone();
                // dispatch_async always defers, even on the main thread, and is
                // serviced by AppKit's modal termination run loop.
                DispatchQueue::main().exec_async(move || {
                    let Some(window) = app.get_webview_window("main") else {
                        complete(&app, &id, true);
                        return;
                    };
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    if let Err(error) = app.emit_to("main", QUIT_REQUEST, &id) {
                        eprintln!("Could not request saving before quitting: {error}");
                    }
                    let deadline =
                        DispatchTime::try_from(QUIT_TIMEOUT).expect("quit timeout is in range");
                    let _ =
                        DispatchQueue::main().after(deadline, move || timeout(&app, &state, &id));
                });
            }),
        },
    )?;
    app.manage(state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::runtime::ClassBuilder;
    use objc2::ClassType;
    use std::ffi::CString;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn replies_are_correlated_and_timeout_cannot_complete_a_later_request() {
        let state = QuitState::default();
        assert_eq!(state.begin(false), (NOW, None));
        let (reply, first) = state.begin(true);
        assert_eq!(reply, LATER);
        let first = first.unwrap();
        assert_eq!(state.begin(true), (LATER, None));
        assert!(state.claim(&first));
        assert!(!state.claim(&first));
        assert!(
            !state.pending(&first),
            "the watchdog must not prompt after a reply is claimed"
        );
        assert_eq!(
            state.begin(true),
            (LATER, None),
            "keep the request until AppKit receives its reply"
        );
        assert!(state.finish(&first));
        assert!(!state.finish(&first));
        let second = state.begin(true).1.unwrap();
        assert!(!state.finish(&first));
        assert!(state.pending(&second));
        assert!(state.finish(&second));
    }

    #[test]
    fn timeout_never_discards_edits_without_an_explicit_quit_choice() {
        use rfd::MessageDialogResult::{Cancel, Custom, No, Ok, Yes};
        for choice in [
            Cancel,
            Ok,
            Yes,
            Custom("Keep Open".into()),
            Custom("Cancel".into()),
        ] {
            assert!(!chose_quit_without_saving(&choice));
        }
        assert!(chose_quit_without_saving(&Custom(
            "Quit Without Saving".into()
        )));
        assert!(chose_quit_without_saving(&No));
    }

    #[test]
    fn native_dispatch_uses_independent_delegate_state_and_allows_retry() {
        for _ in 0..2 {
            let name = CString::new(format!(
                "ScratchpadQuitTest{}",
                uuid::Uuid::new_v4().simple()
            ))
            .unwrap();
            let class = ClassBuilder::new(&name, NSObject::class())
                .unwrap()
                .register();
            let state = Arc::new(QuitState::default());
            let main = Arc::new(AtomicBool::new(true));
            let has_main = main.clone();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let record = requests.clone();
            // SAFETY: this subclass inherits NSObject's new and adds no ivars.
            let delegate: Retained<AnyObject> = unsafe { msg_send![class, new] };
            attach_bridge(
                &delegate,
                Bridge {
                    state: state.clone(),
                    has_main: Box::new(move || has_main.load(Ordering::SeqCst)),
                    request: Box::new(move |id| record.lock().unwrap().push(id)),
                },
            )
            .unwrap();
            install_on_class(class).unwrap(); // Repeated setup never overwrites a method.
            unsafe {
                let reply: usize = msg_send![&*delegate, applicationShouldTerminate: &*delegate];
                assert_eq!(reply, LATER);
                let first = requests.lock().unwrap()[0].clone();
                assert!(state.finish(&first)); // Save failure / Keep Open cancels this request.
                let reply: usize = msg_send![&*delegate, applicationShouldTerminate: &*delegate];
                assert_eq!(reply, LATER);
                assert_eq!(requests.lock().unwrap().len(), 2);
                main.store(false, Ordering::SeqCst);
                let reply: usize = msg_send![&*delegate, applicationShouldTerminate: &*delegate];
                assert_eq!(reply, NOW);
            }
        }
    }

    #[test]
    fn existing_runtime_termination_callback_is_not_replaced() {
        extern "C-unwind" fn existing(_: &AnyObject, _: Sel, _: &AnyObject) -> usize {
            NOW
        }
        let name = CString::new(format!(
            "ScratchpadRuntimeQuit{}",
            uuid::Uuid::new_v4().simple()
        ))
        .unwrap();
        let mut builder = ClassBuilder::new(&name, NSObject::class()).unwrap();
        unsafe {
            builder.add_method(
                sel!(applicationShouldTerminate:),
                existing as extern "C-unwind" fn(_, _, _) -> _,
            );
        }
        let class = builder.register();
        assert!(install_on_class(class).is_err());
        let delegate: Retained<AnyObject> = unsafe { msg_send![class, new] };
        let reply: usize = unsafe { msg_send![&*delegate, applicationShouldTerminate: &*delegate] };
        assert_eq!(reply, NOW);
    }
}
