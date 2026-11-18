// Windows 11 applies rounded corners to top-level windows by default.
// Ask DWM to keep the original MSN/Vista-style square corners for every
// window (including Tauri-created chat and popup windows).
#[cfg(target_os = "windows")]
fn request_square_corners(window: &tauri::Window) {
    use std::ffi::c_void;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *const c_void,
            value_size: u32,
        ) -> i32;
    }

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_DONOTROUND: u32 = 1;

    match window.hwnd() {
        Ok(hwnd) => {
            let preference = DWMWCP_DONOTROUND;
            // SAFETY: `hwnd` belongs to the live window. The API reads a
            // 4-byte preference value; no Rust memory is retained by DWM.
            let result = unsafe {
                DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    (&preference as *const u32).cast::<c_void>(),
                    std::mem::size_of::<u32>() as u32,
                )
            };
            if result < 0 {
                eprintln!("Windows could not disable rounded corners (HRESULT {result:#x})");
            }
        }
        Err(error) => eprintln!("Could not get window handle to set square corners: {error}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // `on_window_ready` is invoked for the initial window and every new
    // Tauri window, so chats, settings and notification popups also stay square.
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("square-corners")
            .on_window_ready(|window| request_square_corners(&window))
            .build(),
    );

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running Retro Messenger");
}
