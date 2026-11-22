//! Many Apply desktop shell.
//!
//! The app is local-first: the web front end reads and writes the user's vault folder through the
//! fs plugin. Rust adds three small things the browser can't do on its own:
//! - storing the Todoist token in the OS keychain (never in the vault),
//! - opening links in the default browser,
//! - a tiny HTTP listener on 127.0.0.1 so the Chrome extension can hand over grants.

mod bridge;

use tauri::Manager;

const KEYCHAIN_SERVICE: &str = "app.manyapply.desktop";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err("Only web and mailto links can be opened".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(bridge::BridgeState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<bridge::BridgeState>().inner().clone();
            bridge::start(handle, state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_set,
            secret_delete,
            open_url,
            bridge::bridge_set_code,
            bridge::bridge_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Many Apply");
}
