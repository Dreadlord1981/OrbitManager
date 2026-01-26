mod manager;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Handle autostart plugin
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Orbit Manager")
                .build(),
        )
        .manage(manager::ManagerState::new())
        .setup(|app| {
            // Read settings to check start_hidden
            let settings_path = manager::get_settings_path(app.handle());
            let start_hidden = if settings_path.exists() {
                if let Ok(content) = std::fs::read_to_string(settings_path) {
                    if let Ok(settings) = serde_json::from_str::<manager::AppSettings>(&content) {
                        settings.start_hidden
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            };

            // Tray Setup
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap();
            let show_i =
                MenuItem::with_id(app, "show", "Show Orbit Manager", true, None::<&str>).unwrap();
            let start_all_i =
                MenuItem::with_id(app, "start_all", "Start All Servers", true, None::<&str>)
                    .unwrap();
            let stop_all_i =
                MenuItem::with_id(app, "stop_all", "Stop All Servers", true, None::<&str>).unwrap();
            let menu =
                Menu::with_items(app, &[&show_i, &start_all_i, &stop_all_i, &quit_i]).unwrap();

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).unwrap())
                .tooltip("Orbit Manager")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    "start_all" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<manager::ManagerState>();
                            let path = app_handle
                                .path()
                                .app_data_dir()
                                .unwrap()
                                .join("servers.json");
                            if path.exists() {
                                if let Ok(content) = std::fs::read_to_string(&path) {
                                    if let Ok(servers) =
                                        serde_json::from_str::<Vec<manager::ServerConfig>>(&content)
                                    {
                                        for server in servers {
                                            let _ = manager::start_server(
                                                app_handle.clone(),
                                                state.clone(),
                                                server.id,
                                            )
                                            .await;
                                        }
                                    }
                                }
                            }
                        });
                    }
                    "stop_all" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<manager::ManagerState>();
                            // We need to collect IDs first to avoid deadlock or iteration issues if we used stop_server?
                            // stop_server removes from map.
                            // But we can just iterate the map keys.
                            let ids: Vec<String> = {
                                let processes = state.processes.lock().unwrap();
                                processes.keys().cloned().collect()
                            };
                            for id in ids {
                                let _ = manager::stop_server(state.clone(), id).await;
                            }
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            if !start_hidden {
                let splash_window = tauri::WebviewWindowBuilder::new(
                    app,
                    "splashscreen",
                    tauri::WebviewUrl::App("splash.html".into()),
                )
                .title("Orbit Manager Loading")
                .transparent(true)
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .shadow(false)
                .inner_size(400.0, 400.0)
                .center()
                .build()?;
                let _ = splash_window.show();
            }

            // Auto-start logic
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                tauri::async_runtime::block_on(async move {
                    let state = app_handle.state::<manager::ManagerState>();
                    let path = app_handle
                        .path()
                        .app_data_dir()
                        .unwrap()
                        .join("servers.json");

                    if path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            if let Ok(servers) =
                                serde_json::from_str::<Vec<manager::ServerConfig>>(&content)
                            {
                                for server in servers {
                                    if server.auto_start {
                                        let _ = manager::start_server(
                                            app_handle.clone(),
                                            state.clone(),
                                            server.id,
                                        )
                                        .await;
                                    }
                                }
                            }
                        }
                    }
                });
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            manager::get_servers,
            manager::save_server,
            manager::delete_server,
            manager::start_server,
            manager::stop_server,
            manager::get_log_history,
            manager::clear_logs,
            manager::open_in_explorer,
            manager::read_config_file,
            manager::save_config_file,
            manager::open_server_browser,
            manager::get_app_settings,
            manager::save_app_settings,
            manager::close_splash
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Graceful shutdown
                let state = app_handle.state::<manager::ManagerState>();
                let mut processes = state.processes.lock().unwrap();
                for (_, child) in processes.iter_mut() {
                    let _ = child.kill();
                }
            }
        });
}
