//! Many Apply desktop shell.
//!
//! The app is local-first: the web front end reads and writes the user's vault folder through the
//! fs plugin. Rust adds three small things the browser can't do on its own:
//! - storing the Todoist token in the OS keychain (never in the vault),
//! - opening links in the default browser, and vault files (work samples) in their default app,
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

/// File types a work sample or document can be. Anything else (apps, scripts, installers) is refused, so a file
/// dropped into the vault by someone else can't be launched from inside Many Apply.
const OPENABLE: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "tif", "tiff", "bmp", "svg",
    "mp4", "mov", "m4v", "webm", "mkv", "avi",
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "aif", "aiff",
    "pdf", "doc", "docx", "pages", "txt", "rtf", "odt", "key", "ppt", "pptx",
    "xls", "xlsx", "csv", "numbers",
];

#[tauri::command]
fn open_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    use tauri_plugin_opener::OpenerExt;
    let p = std::path::Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !OPENABLE.contains(&ext.as_str()) {
        return Err("Only images, video, audio and documents can be opened".into());
    }
    // Only files inside folders the user has given Many Apply access to (the vault).
    if !app.fs_scope().is_allowed(p) {
        return Err("That file isn't in your vault".into());
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Read an RSS or Atom feed for the Opportunity feeds panel. GET only, no cookies, capped in size,
/// so the web side can read any feed the user adds without being able to send anything else.
#[tauri::command]
async fn fetch_feed(url: String) -> Result<String, String> {
    use tauri_plugin_http::reqwest;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Feed links start with https://".into());
    }
    const MAX: usize = 5 * 1024 * 1024;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("ManyApply/0.6 (RSS reader)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the feed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("The feed answered {}", resp.status()));
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX) {
        return Err("That feed is too big (over 5 MB)".into());
    }
    // Read in pieces and stop at the cap, so a feed that doesn't say its size can't fill memory.
    let mut resp = resp;
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX {
            return Err("That feed is too big (over 5 MB)".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
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
            open_file,
            fetch_feed,
            bridge::bridge_set_code,
            bridge::bridge_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Many Apply");
}
