use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Maps jobId -> ffmpeg PID, so `cancel` can kill the process by PID.
/// The Child itself stays in `convert`'s scope (it owns the stdout/stderr
/// readers and the wait() handle); only the PID is shared here.
#[derive(Default, Clone)]
pub struct ProcessRegistry(pub Arc<Mutex<HashMap<String, u32>>>);

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
