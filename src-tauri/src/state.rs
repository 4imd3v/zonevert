use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

/// Maps jobId -> (ffmpeg PID, cancel signal).
///
/// `cancel` notifies the `run` loop, which owns the `Child` and performs the
/// graceful SIGTERM -> bounded SIGKILL escalation itself, so signals are only
/// ever sent to a live child (no PID-reuse window). The PID is kept solely
/// for shutdown cleanup (window destroy kills directly at app exit).
#[derive(Default, Clone)]
pub struct ProcessRegistry(pub Arc<Mutex<HashMap<String, (u32, Arc<Notify>)>>>);

/// Kill a process by PID. Cross-platform: SIGTERM on unix, TerminateProcess
/// on Windows. No-op if the PID is stale (process already exited).
#[cfg(unix)]
pub fn kill_pid(pid: u32) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
}

#[cfg(windows)]
pub fn kill_pid(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle != std::ptr::null_mut() {
            TerminateProcess(handle, 1);
            CloseHandle(handle);
        }
    }
}
