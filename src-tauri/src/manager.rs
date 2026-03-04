use chrono::Local;
use expand_env_vars::expand_env_vars;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub config_path: String,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub verbose: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub autostart: bool,
    pub start_hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<i64>, // Unix timestamp in milliseconds
}

// We need a thread-safe way to store children.
// Tauri State is global.
// We can use Arc<Mutex<HashMap<String, std::process::Child>>>.
// But `Child` doesn't implement some traits? No, it should be fine in a Mutex.

pub struct ManagerState {
    pub processes: Arc<Mutex<HashMap<String, std::process::Child>>>,
}

impl ManagerState {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn expand_path(path: &str) -> String {
    // 1. Expand Windows-style %VAR% variables
    let windows_expanded = expand_env_vars(path).unwrap_or_else(|_| path.to_string());

    // 2. Expand Unix-style $VAR and ~ tilde expansion
    let final_expanded = shellexpand::full(&windows_expanded)
        .unwrap_or_else(|_| windows_expanded.clone().into())
        .into_owned();

    final_expanded
}

fn strip_ansi(input: &str) -> String {
    // Regex for ANSI escape codes
    let re = Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    re.replace_all(input, "").to_string()
}

fn ensure_defaults<R: Runtime>(app: &AppHandle<R>, config: &ServerConfig) -> std::io::Result<()> {
    let expanded_path = expand_path(&config.path);
    let server_path = PathBuf::from(&expanded_path);
    let config_file_name = &config.config_path;

    let parent = if server_path.extension().is_some() {
        server_path
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .to_path_buf()
    } else {
        server_path.clone()
    };

    if !parent.exists() {
        fs::create_dir_all(&parent)?;
    }

    let bin_path = get_bin_path(app);

    let index_path = parent.join("index.html");
    if !index_path.exists() {
        let template_path = bin_path.join("default.html");
        let content = fs::read_to_string(template_path)?;
        let content = content.replace("{{name}}", &config.name);
        fs::write(index_path, content)?;
    }

    let target_config_file = if !config_file_name.is_empty() {
        server_path.join(config_file_name)
    } else {
        server_path.join("webconfig.toml")
    };

    if !target_config_file.exists() {
        let template_path = bin_path.join("default.toml");
        let content = fs::read_to_string(template_path)?;
        let content = content.replace("{{name}}", &config.name);
        fs::write(target_config_file, content)?;
    }

    Ok(())
}

// Persistence Helper
pub fn get_servers_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let data_dir = app.path().app_data_dir().unwrap();
    let orbit_path = data_dir.join("OrbitManager");
    orbit_path.join("servers.json")
}

pub fn get_settings_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let data_dir = app.path().app_data_dir().unwrap();
    let orbit_path = data_dir.join("OrbitManager");
    orbit_path.join("settings.json")
}

#[tauri::command]
pub async fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> Result<AppSettings, String> {
    let path = get_settings_path(&app);

    // Ensure directory exists so we don't fail on save later
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let settings = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        let default_settings = AppSettings::default();
        let content = serde_json::to_string_pretty(&default_settings).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())?;
        default_settings
    };

    Ok(settings)
}

#[tauri::command]
pub async fn save_app_settings<R: Runtime>(
    app: AppHandle<R>,
    mut settings: AppSettings,
) -> Result<(), String> {
    let path = get_settings_path(&app);

    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }

    // Set the current timestamp
    settings.last_modified = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64,
    );

    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(())
}

fn get_log_path<R: Runtime>(config: &ServerConfig, app: &AppHandle<R>) -> PathBuf {
    let data_dir = app.path().app_data_dir().unwrap();
    let orbit_path = data_dir.join("OrbitManager");

    let server_name = &config.name;

    let mut server_path = orbit_path.join(server_name);

    let time_path = Local::now().format("%Y-%m-%d").to_string();

    server_path.push(time_path);

    if !server_path.exists() {
        let _ = fs::create_dir_all(&server_path);
    }

    server_path.join("orbit_sever.log")
}

fn get_config_full_path(config: &ServerConfig) -> PathBuf {
    let expanded_path = expand_path(&config.path);
    let server_path = PathBuf::from(&expanded_path);

    let root = if server_path.extension().is_some() {
        server_path
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .to_path_buf()
    } else {
        server_path
    };

    if !config.config_path.is_empty() {
        root.join(&config.config_path)
    } else {
        root.join("webconfig.toml")
    }
}

// Get the bin directory
fn get_bin_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .resolve("bin", tauri::path::BaseDirectory::Resource)
        .unwrap()
}

// Get the server address (localhost:port) from config file
fn get_server_address(config: &ServerConfig) -> String {
    let config_path = get_config_full_path(config);

    if !config_path.exists() {
        return String::from("—");
    }

    match fs::read_to_string(&config_path) {
        Ok(content) => match toml::from_str::<toml::Value>(&content) {
            Ok(value) => {
                if let Some(port) = value
                    .get("server")
                    .and_then(|s| s.get("port"))
                    .and_then(|p| p.as_integer())
                {
                    format!("localhost:{}", port)
                } else {
                    String::from("—")
                }
            }
            Err(_) => String::from("—"),
        },
        Err(_) => String::from("—"),
    }
}

#[tauri::command]
pub async fn get_servers<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ManagerState>,
) -> Result<Vec<serde_json::Value>, String> {
    let path = get_servers_path(&app);

    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };

    // Enrich with status
    let processes = state.processes.lock().unwrap();

    let mut result = Vec::new();

    for s in servers {
        let running = processes.contains_key(&s.id);
        let mut v = serde_json::to_value(&s).unwrap();

        // Try to get the port from config file
        let address = get_server_address(&s);

        let obj = v.as_object_mut().unwrap();
        obj.insert("running".to_string(), serde_json::Value::Bool(running));
        obj.insert("address".to_string(), serde_json::Value::String(address));

        result.push(v);
    }

    Ok(result)
}

#[tauri::command]
pub async fn save_server<R: Runtime>(
    app: AppHandle<R>,
    config: ServerConfig,
) -> Result<(), String> {
    let path = get_servers_path(&app);

    ensure_defaults(&app, &config).map_err(|e| e.to_string())?;

    // Ensure dir exists

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    if let Some(pos) = servers.iter().position(|s| s.id == config.id) {
        servers[pos] = config;
    } else {
        servers.push(config);
    }

    let json = serde_json::to_string_pretty(&servers).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    crate::update_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn delete_server<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let path = get_servers_path(&app);

    let mut servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Ok(());
    };

    servers.retain(|s| s.id != id);

    let json = serde_json::to_string_pretty(&servers).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    crate::update_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn start_server<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ManagerState>,
    id: String,
) -> Result<(), String> {
    // 1. Get config
    let path = get_servers_path(&app);

    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Err("No servers found".to_string());
    };

    let config = servers
        .iter()
        .find(|s| s.id == id)
        .ok_or("Server not found")?;

    ensure_defaults(&app, config).map_err(|e| e.to_string())?;

    // 2. Check if running
    {
        let mut processes = state.processes.lock().unwrap();
        if processes.contains_key(&id) {
            // Check if it's actually alive?
            // Child::try_wait() can check.
            if let Some(child) = processes.get_mut(&id) {
                if let Ok(None) = child.try_wait() {
                    return Err("Server already running".to_string());
                }
                // If it finished, remove it.
                processes.remove(&id);
            }
        }
    }

    // 3. Start Process
    let bin_path = get_bin_path(&app);
    let exe_path = bin_path.join("iceserver.exe");

    // Prepare command
    let mut cmd = Command::new(exe_path);

    let config_path = expand_path(&config.path);

    let mut config_path = PathBuf::from(&config_path);

    if !config.config_path.is_empty() {
        config_path = config_path.join(&config.config_path);
    }

    cmd.arg("-r").arg(&config_path);

    if config.verbose {
        cmd.arg("-v");
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

    // 4. Stream output
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let id_clone = id.clone();
    let app_handle = app.clone();

    let log_path = get_log_path(config, &app);
    let log_path_err = log_path.clone();

    thread::spawn(move || {
        let mut log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .ok();

        let reader = BufReader::new(stdout);
        for l in reader.lines().map_while(Result::ok) {
            let clean_line = strip_ansi(&l);
            if let Some(ref mut f) = log_file {
                let _ = writeln!(f, "{}", clean_line);
            }
            let _ = app_handle.emit(
                "server-output",
                serde_json::json!({ "id": id_clone, "line": clean_line, "stream": "stdout" }),
            );
        }
        let _ = app_handle.emit(
            "server-status",
            serde_json::json!({ "id": id_clone, "status": "stopped" }),
        );
        crate::update_tray_menu(&app_handle);
    });

    let id_clone_err = id.clone();
    let app_handle_err = app.clone();
    thread::spawn(move || {
        let mut log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path_err)
            .ok();

        let reader = BufReader::new(stderr);
        for l in reader.lines().map_while(Result::ok) {
            let clean_line = strip_ansi(&l);
            if let Some(ref mut f) = log_file {
                let _ = writeln!(f, "{}", clean_line);
            }
            let _ = app_handle_err.emit(
                "server-output",
                serde_json::json!({ "id": id_clone_err, "line": clean_line, "stream": "stderr" }),
            );
        }
    });

    state.processes.lock().unwrap().insert(id.clone(), child);

    app.emit(
        "server-status",
        serde_json::json!({ "id": id, "status": "running" }),
    )
    .unwrap();

    crate::update_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn stop_server<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, ManagerState>,
    id: String,
) -> Result<(), String> {
    let child = {
        let mut processes = state.processes.lock().unwrap();
        processes.remove(&id)
    };

    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = app.emit(
            "server-status",
            serde_json::json!({ "id": id, "status": "stopped" }),
        );
        crate::update_tray_menu(&app);
    } else {
        return Err("Server not running".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_log_history<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let path = get_servers_path(&app);
    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Ok(Vec::new());
    };

    let config = servers
        .iter()
        .find(|s| s.id == id)
        .ok_or("Server not found")?;
    let log_path = get_log_path(config, &app);

    if !log_path.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(log_path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    // Simple way to get last 200 lines
    let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();
    let start = if lines.len() > 200 {
        lines.len() - 200
    } else {
        0
    };

    let result = lines[start..]
        .iter()
        .map(|l| {
            let clean_line = strip_ansi(l);
            serde_json::json!({ "line": clean_line, "stream": "stdout", "time": "" })
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn clear_logs<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let path = get_servers_path(&app);
    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Err("No servers found".to_string());
    };

    let config = servers
        .iter()
        .find(|s| s.id == id)
        .ok_or("Server not found")?;
    let log_path = get_log_path(config, &app);

    if log_path.exists() {
        fs::remove_file(log_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_in_explorer<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let path = get_servers_path(&app);
    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Err("No servers found".to_string());
    };

    let config = servers
        .iter()
        .find(|s| s.id == id)
        .ok_or("Server not found")?;

    let expanded_path = expand_path(&config.path);
    let mut server_path = PathBuf::from(&expanded_path);

    // Ensure absolute path
    if !server_path.is_absolute() {
        // Resolve relative to current working directory or a sensible base
        if let Ok(cwd) = std::env::current_dir() {
            server_path = cwd.join(server_path);
        }
    }

    // If it's a file, we want the parent directory
    if server_path.is_file() {
        if let Some(parent) = server_path.parent() {
            server_path = parent.to_path_buf();
        }
    } else if !server_path.exists() {
        // If it doesn't exist yet, we can't open it
        return Err(format!("Path does not exist: {}", server_path.display()));
    }

    // Use tauri-plugin-opener for robust cross-platform opening
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(server_path.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn read_config_file<R: Runtime>(app: AppHandle<R>, id: String) -> Result<String, String> {
    let path = get_servers_path(&app);
    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Err("No servers found".to_string());
    };

    let config = servers
        .iter()
        .find(|s| s.id == id)
        .ok_or("Server not found")?;
    let config_path = get_config_full_path(config);

    if !config_path.exists() {
        return Err("Configuration file not found".to_string());
    }

    fs::read_to_string(config_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_config_file<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    content: String,
) -> Result<(), String> {
    let path = get_servers_path(&app);
    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        return Err("No servers found".to_string());
    };

    let config = servers
        .iter()
        .find(|s| s.id == id)
        .ok_or("Server not found")?;
    let config_path = get_config_full_path(config);

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(config_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_splash<R: Runtime>(app: AppHandle<R>) {
    // Check if we should actually show the main window
    let settings = get_app_settings(app.clone()).await.unwrap_or_default();

    if let Some(splash_window) = app.get_webview_window("splashscreen") {
        splash_window.close().unwrap();
    }

    if !settings.start_hidden {
        if let Some(main_window) = app.get_webview_window("main") {
            main_window.show().unwrap();
            main_window.set_focus().unwrap();
        }
    }
}

#[tauri::command]
pub async fn open_server_browser<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let path = get_servers_path(&app);
    let servers: Vec<ServerConfig> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("No servers found".to_string());
    };

    let config = servers
        .iter()
        .find(|s| s.id == id)
        .ok_or("Server not found")?;

    let expanded_base = expand_path(&config.path);
    let base_path = PathBuf::from(&expanded_base);
    let mut config_file = if base_path.extension().is_some() {
        base_path
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .to_path_buf()
    } else {
        base_path.clone()
    };
    config_file.push(&config.config_path);

    if !config_file.exists() {
        return Err(format!("Config file not found at {:?}", config_file));
    }

    let content = fs::read_to_string(&config_file).map_err(|e| e.to_string())?;
    let value: toml::Value =
        toml::from_str(&content).map_err(|e| format!("Failed to parse TOML: {}", e))?;

    let port = value
        .get("server")
        .and_then(|s| s.get("port"))
        .and_then(|p| p.as_integer())
        .ok_or("Port not found in [server] section of config file")?;

    let url = format!("http://localhost:{}", port);

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(url, None::<String>)
        .map_err(|e| e.to_string())?;

    Ok(())
}
