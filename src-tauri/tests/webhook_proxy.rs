//! Webhook POSTs never go through a proxy picked up from the environment.
//!
//! Its own test binary because it sets `HTTP_PROXY` for the whole process; inside the
//! lib's test harness that would race every other test that builds an HTTP client.
use bytes::Bytes;
use dropqtt_lib::webhook::{client, deliver, WebhookConfig};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

/// Accepts one connection, reports its request head, answers 200.
fn spawn_listener() -> (u16, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else { return };
        let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
        let mut raw = Vec::new();
        let mut buf = [0u8; 4096];
        while !raw.windows(4).any(|w| w == b"\r\n\r\n") {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => raw.extend_from_slice(&buf[..n]),
            }
        }
        let _ = tx.send(String::from_utf8_lossy(&raw).to_string());
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    });
    (port, rx)
}

#[tokio::test]
async fn an_environment_proxy_never_sees_the_webhook_request() {
    let (trap_port, trap) = spawn_listener();
    let (sink_port, sink) = spawn_listener();
    let trap_url = format!("http://127.0.0.1:{trap_port}");
    for var in ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
        std::env::set_var(var, &trap_url);
    }
    for var in ["NO_PROXY", "no_proxy"] {
        std::env::remove_var(var);
    }

    let config = WebhookConfig {
        url: format!("http://127.0.0.1:{sink_port}/hook?token=super-secret"),
        format: "raw".into(),
        headers: vec![("Authorization".into(), "Bearer local-only".into())],
        secret_headers: vec![],
    };
    let result = deliver(&client().unwrap(), &config, Bytes::from_static(b"x")).await;

    // Checked before the result so a proxied request is reported as the leak it is,
    // not as whatever the trap's 200 made the delivery look like.
    let leaked = trap.recv_timeout(Duration::from_millis(300)).ok();
    assert!(leaked.is_none(), "request went through the proxy: {leaked:?}");
    result.expect("direct delivery to the sink");
    let request = sink.recv_timeout(Duration::from_secs(2)).expect("sink saw the request");
    assert!(request.starts_with("POST /hook?token=super-secret HTTP/1.1"), "{request}");
}
