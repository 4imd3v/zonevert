mod commands;
mod ffmpeg;
mod state;

use state::ProcessRegistry;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessRegistry::default())
        .on_window_event(|window, event| {
            // Kill any running ffmpeg children when the window closes.
            // ponytail: app-wide quit cleanup; if multi-window is added later,
            // gate this on RunEvent::ExitRequested instead.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<ProcessRegistry>() {
                    let registry = state.0.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut map = registry.lock().await;
                        for (_, pid) in map.drain() {
                            state::kill_pid(pid);
                        }
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::platform,
            commands::probe_ffmpeg,
            commands::convert,
            commands::cancel,
            commands::check_exists,
            commands::save_file,
            commands::image_thumbnail,
            commands::probe_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
