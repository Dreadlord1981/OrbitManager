mod manager;

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .show()
                .and_then(|_| app.get_webview_window("main").unwrap().set_focus());
        }))
        .plugin(tauri_plugin_notification::init())
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
            let tray_menu = build_tray_menu(app.handle());

            let _tray = tauri::tray::TrayIconBuilder::with_id("tray")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).unwrap())
                .tooltip("Orbit Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id == "quit" {
                        app.exit(0);
                    } else if id == "show" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if id == "start_all" {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<manager::ManagerState>();
                            let path = manager::get_servers_path(&app_handle);
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
                                        update_tray_menu(&app_handle);
                                        let _ = app_handle.notification().builder().title("Orbit Manager").body("All Servers Started").show();
                                    }
                                }
                            }
                        });
                    } else if id == "stop_all" {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<manager::ManagerState>();
                            let ids: Vec<String> = {
                                let processes = state.processes.lock().unwrap();
                                processes.keys().cloned().collect()
                            };
                            for sid in ids {
                                let _ =
                                    manager::stop_server(app_handle.clone(), state.clone(), sid)
                                        .await;
                            }
                            update_tray_menu(&app_handle);
                            let _ = app_handle.notification().builder().title("Orbit Manager").body("All Servers Stopped").show();
                        });
                    } else if id.starts_with("toggle:") {
                        let server_id = id.replace("toggle:", "");
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<manager::ManagerState>();
                            let running = {
                                let processes = state.processes.lock().unwrap();
                                processes.contains_key(&server_id)
                            };

                            let new_running = if running {
                                let _ = manager::stop_server(
                                    app_handle.clone(),
                                    state.clone(),
                                    server_id.clone(),
                                )
                                .await;
                                false
                            } else {
                                let _ = manager::start_server(
                                    app_handle.clone(),
                                    state.clone(),
                                    server_id.clone(),
                                )
                                .await;
                                true
                            };

                            // Get server name for notification
                            let mut server_name = "Server".to_string();
                            let path = manager::get_servers_path(&app_handle);
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                if let Ok(servers) =
                                    serde_json::from_str::<Vec<manager::ServerConfig>>(&content)
                                {
                                    if let Some(s) = servers.into_iter().find(|s| s.id == server_id)
                                    {
                                        server_name = s.name;
                                    }
                                }
                            }

                            update_tray_menu(&app_handle);

                            let status_text = if new_running { "Started" } else { "Stopped" };
                            let _ = app_handle
                                .notification()
                                .builder()
                                .title("Orbit Manager")
                                .body(format!("{} {}", server_name, status_text))
                                .show();
                        });
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
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
                    let path = manager::get_servers_path(&app_handle);

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

pub fn update_tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let menu = build_tray_menu(app);

    if let Some(tray) = app.tray_by_id("tray") {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::menu::Menu<R> {
    use tauri::menu::{IconMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let show_i = MenuItem::with_id(app, "show", "Show Orbit Manager", true, None::<&str>).unwrap();
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap();
    let sep = PredefinedMenuItem::separator(app).unwrap();

    // Icons
    let active_icon =
        tauri::image::Image::from_bytes(include_bytes!("../icons/active.png")).unwrap();
    let inactive_icon =
        tauri::image::Image::from_bytes(include_bytes!("../icons/inactive.png")).unwrap();

    // Servers Submenu
    let state = app.state::<manager::ManagerState>();
    let servers_path = manager::get_servers_path(app);
    let mut server_items: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
    let mut has_servers = false;

    if servers_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&servers_path) {
            if let Ok(servers) = serde_json::from_str::<Vec<manager::ServerConfig>>(&content) {
                has_servers = !servers.is_empty();
                let processes = state.processes.lock().unwrap();
                for server in servers {
                    let running = processes.contains_key(&server.id);
                    let icon = if running {
                        Some(active_icon.clone())
                    } else {
                        Some(inactive_icon.clone())
                    };
                    let item = IconMenuItem::with_id(
                        app,
                        format!("toggle:{}", server.id),
                        &server.name,
                        true,
                        icon,
                        None::<&str>,
                    )
                    .unwrap();
                    server_items.push(Box::new(item));
                }
            }
        }
    }

    let start_all_i = MenuItem::with_id(
        app,
        "start_all",
        "Start All Servers",
        has_servers,
        None::<&str>,
    )
    .unwrap();
    let stop_all_i = MenuItem::with_id(
        app,
        "stop_all",
        "Stop All Servers",
        has_servers,
        None::<&str>,
    )
    .unwrap();

    let servers_submenu = Submenu::with_items(
        app,
        "Servers",
        has_servers,
        &server_items.iter().map(|i| i.as_ref()).collect::<Vec<_>>(),
    )
    .unwrap();

    Menu::with_items(
        app,
        &[
            &show_i,
            &sep,
            &start_all_i,
            &stop_all_i,
            &sep,
            &servers_submenu,
            &sep,
            &quit_i,
        ],
    )
    .unwrap()
}
