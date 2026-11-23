//! Local listener for the Chrome extension (Phase 2).
//!
//! Binds to 127.0.0.1 only. Every request that hands over data must carry the pairing code shown in
//! Settings, so other software on the machine (or web pages) can't inject grants. On top of that:
//! - requests must be addressed to 127.0.0.1 or localhost (the Host header), which stops a web page
//!   using DNS rebinding to reach the listener under its own domain;
//! - a request that comes from a web page (an Origin that isn't an extension) is refused;
//! - wrong codes are slowed down, and after repeated failures the listener stops accepting codes for
//!   a minute, so the six-digit code can't be guessed by trying them all.

use std::io::Read as _;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server};

pub const PORT: u16 = 47321;
const MAX_BODY: usize = 256 * 1024;
/// Wrong codes in a row before the listener stops accepting codes for LOCKOUT.
const MAX_FAILURES: u32 = 10;
const LOCKOUT: Duration = Duration::from_secs(60);
/// Pause after each wrong code. The listener handles one request at a time, so this slows every guess.
const FAILURE_DELAY: Duration = Duration::from_millis(400);

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

/// Only requests addressed to this machine by name or loopback address. A rebinding attack arrives with the
/// attacker's own host name here.
fn host_ok(host: Option<&str>) -> bool {
    matches!(host, Some(h) if h == format!("127.0.0.1:{PORT}") || h == format!("localhost:{PORT}"))
}

/// A web page's Origin (anything but an extension) is refused for requests that carry data.
fn origin_ok(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(o) => o.starts_with("chrome-extension://") || o.starts_with("moz-extension://"),
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
        let mut failures: u32 = 0;
        let mut locked_until: Option<Instant> = None;
        for mut req in server.incoming_requests() {
            let host = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Host"))
                .map(|h| h.value.as_str().to_string());
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
            let locked = locked_until.is_some_and(|t| Instant::now() < t);
            let paired = !locked && !expected.is_empty() && same(&given, &expected);
            // Count a wrong code only when one was actually offered (a bare /ping from the extension isn't a guess).
            if !given.is_empty() && !locked {
                if paired {
                    failures = 0;
                } else {
                    failures += 1;
                    thread::sleep(FAILURE_DELAY);
                    if failures >= MAX_FAILURES {
                        locked_until = Some(Instant::now() + LOCKOUT);
                        failures = 0;
                    }
                }
            }

            let resp = match (req.method(), req.url()) {
                _ if !host_ok(host.as_deref()) => reply(403, json!({ "error": "Not allowed" }), None),
                (Method::Options, _) => reply(204, json!({}), origin),
                (Method::Get, "/ping") => reply(200, json!({ "app": "many-apply", "paired": paired }), origin),
                (Method::Post, "/grant") => {
                    if !origin_ok(origin) {
                        reply(403, json!({ "error": "Not allowed" }), None)
                    } else if locked {
                        reply(429, json!({ "error": "Too many wrong pairing codes. Wait a minute, then check the code in Many Apply's Settings." }), origin)
                    } else if !paired {
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

