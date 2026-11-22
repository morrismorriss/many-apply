//! Local listener for the Chrome extension (Phase 2).
//!
//! Binds to 127.0.0.1 only. Every request that hands over data must carry the pairing code shown in
//! Settings, so other software on the machine (or web pages) can't inject grants.

use std::io::Read as _;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server};

pub const PORT: u16 = 47321;
const MAX_BODY: usize = 256 * 1024;

#[derive(Clone, Default)]
pub struct BridgeState {
    code: Arc<Mutex<String>>,
    running: Arc<Mutex<bool>>,
}

#[tauri::command]
pub fn bridge_set_code(state: tauri::State<'_, BridgeState>, code: String) {
    *state.code.lock().unwrap() = code;
}

#[tauri::command]
pub fn bridge_status(state: tauri::State<'_, BridgeState>) -> Value {
    json!({ "port": PORT, "running": *state.running.lock().unwrap() })
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn cors(origin: Option<&str>) -> Vec<Header> {
    // Only extension pages may call us cross-origin. Web pages get no CORS headers at all.
    match origin {
        Some(o) if o.starts_with("chrome-extension://") || o.starts_with("moz-extension://") => vec![
            header("Access-Control-Allow-Origin", o),
            header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
            header("Access-Control-Allow-Headers", "Content-Type, X-Pairing-Code"),
            header("Vary", "Origin"),
        ],
        _ => vec![],
    }
}

fn reply(status: u16, body: Value, origin: Option<&str>) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut r = Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(header("Content-Type", "application/json"));
    for h in cors(origin) {
        r = r.with_header(h);
    }
    r
}

/// Constant-time-ish comparison so the code can't be guessed by timing.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn start(app: AppHandle, state: BridgeState) {
    thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Many Apply: extension listener not started: {e}");
                return;
            }
        };
        *state.running.lock().unwrap() = true;
        for mut req in server.incoming_requests() {
            let origin = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Origin"))
                .map(|h| h.value.as_str().to_string());
            let origin = origin.as_deref();
            let given = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("X-Pairing-Code"))
                .map(|h| h.value.as_str().trim().to_string())
                .unwrap_or_default();
            let expected = state.code.lock().unwrap().clone();
            let paired = !expected.is_empty() && same(&given, &expected);

            let resp = match (req.method(), req.url()) {
                (Method::Options, _) => reply(204, json!({}), origin),
                (Method::Get, "/ping") => reply(200, json!({ "app": "many-apply", "paired": paired }), origin),
                (Method::Post, "/grant") => {
                    if !paired {
                        reply(401, json!({ "error": "Wrong pairing code. Check Settings in Many Apply." }), origin)
                    } else {
                        let mut body = String::new();
                        let ok = req.as_reader().take(MAX_BODY as u64 + 1)
                            .read_to_string(&mut body)
                            .is_ok();
                        match (ok && body.len() <= MAX_BODY).then(|| serde_json::from_str::<Value>(&body)) {
                            Some(Ok(v)) if v.get("title").and_then(|t| t.as_str()).map_or(false, |t| !t.trim().is_empty()) => {
                                let _ = app.emit("extension-grant", v);
                                reply(200, json!({ "ok": true }), origin)
                            }
                            _ => reply(400, json!({ "error": "Expected JSON with a title" }), origin),
                        }
                    }
                }
                _ => reply(404, json!({ "error": "Not found" }), origin),
            };
            let _ = req.respond(resp);
        }
    });
}

