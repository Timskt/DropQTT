//! Bounded HTTP sink for desktop integrations. No automatic retries: repeating
//! an arbitrary POST can duplicate a business action. The bridge reports errors.
use bytes::Bytes;
use reqwest::{header::{HeaderMap, HeaderName, HeaderValue}, Client, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookConfig {
    pub url: String,
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

fn default_format() -> String { "json".into() }

impl Default for WebhookConfig {
    fn default() -> Self { Self { url: String::new(), format: default_format(), headers: Vec::new() } }
}

impl WebhookConfig {
    pub fn validate(&self) -> Result<(), String> {
        let url = Url::parse(self.url.trim()).map_err(|_| "Webhook URL is invalid")?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("Webhook URL must use HTTP or HTTPS".into());
        }
        if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
            return Err("Use headers for authentication; URL credentials and fragments are unsupported".into());
        }
        if !matches!(self.format.as_str(), "raw" | "json") {
            return Err("Webhook body format must be raw or json".into());
        }
        self.header_map()?;
        Ok(())
    }

    fn header_map(&self) -> Result<HeaderMap, String> {
        let mut headers = HeaderMap::new();
        for (name, value) in &self.headers {
            let name = HeaderName::from_bytes(name.trim().as_bytes()).map_err(|_| "Invalid webhook header name")?;
            if matches!(name.as_str(), "host" | "content-length" | "connection" | "transfer-encoding") {
                return Err("Transport headers are managed automatically".into());
            }
            let value = HeaderValue::from_str(value).map_err(|_| "Invalid webhook header value")?;
            headers.insert(name, value);
        }
        Ok(headers)
    }

    /// Logs never expose URL paths or queries, which can contain webhook tokens.
    pub fn display_target(&self) -> String {
        Url::parse(self.url.trim()).map(|u| format!("POST {}", u.origin().ascii_serialization()))
            .unwrap_or_else(|_| "HTTP POST".into())
    }
}

pub fn client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| e.without_url().to_string())
}

pub fn encode_body(config: &WebhookConfig, topic: &str, payload: &Bytes, qos: u8, retain: bool) -> Bytes {
    if config.format == "raw" { return payload.clone(); }
    let mut body = serde_json::json!({
        "topic": topic, "qos": qos, "retain": retain,
        "timestamp": chrono::Utc::now().timestamp_millis(),
    });
    match std::str::from_utf8(payload) {
        Ok(text) => { body["payload"] = serde_json::Value::String(text.into()); }
        Err(_) => {
            use base64::Engine;
            body["payloadBase64"] = base64::engine::general_purpose::STANDARD.encode(payload).into();
        }
    }
    Bytes::from(body.to_string())
}

pub async fn deliver(client: &Client, config: &WebhookConfig, body: Bytes) -> Result<(), String> {
    config.validate()?;
    let content_type = if config.format == "json" { "application/json" } else { "application/octet-stream" };
    let response = client.post(config.url.trim())
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .headers(config.header_map()?)
        .body(body).send().await.map_err(|e| e.without_url().to_string())?;
    if response.status().is_success() { Ok(()) }
    else { Err(format!("HTTP {}", response.status())) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    #[test]
    fn validates_local_http_and_protects_transport_headers() {
        let mut config = WebhookConfig { url: "http://127.0.0.1:8080/events".into(), ..Default::default() };
        assert!(config.validate().is_ok());
        for url in ["file:///tmp/out", "ftp://host", "https://user:secret@host", "https://host/#fragment"] {
            config.url = url.into();
            assert!(config.validate().is_err());
        }
        config.url = "https://example.com/secret-path?token=secret".into();
        assert_eq!(config.display_target(), "POST https://example.com");
        config.headers = vec![("Content-Length".into(), "12".into())];
        assert!(config.validate().is_err());
        config.headers = vec![("Authorization".into(), "bad\r\nInjected: yes".into())];
        assert!(config.validate().is_err());
    }

    #[test]
    fn json_envelope_preserves_binary_and_raw_body_is_unchanged() {
        let mut config = WebhookConfig::default();
        let data = Bytes::from_static(&[0xff, 0, 0xfe]);
        let body = encode_body(&config, "sensor/1", &data, 1, true);
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["payloadBase64"], "/wD+");
        assert_eq!(value["topic"], "sensor/1");
        assert_eq!(value["retain"], true);
        config.format = "raw".into();
        assert_eq!(encode_body(&config, "sensor/1", &data, 1, true), data);
    }

    /// One-shot local HTTP sink: records the raw request, then answers `status`.
    fn spawn_sink(status: &str, extra_headers: &str) -> (u16, Arc<Mutex<String>>) {
        use std::io::{Read, Write};

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local sink");
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(String::new()));
        let sink_seen = seen.clone();
        let status = status.to_string();
        let extra_headers = extra_headers.to_string();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else { return };
            let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
            let mut raw: Vec<u8> = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => raw.extend_from_slice(&buf[..n]),
                }
                let Some(head_end) = raw.windows(4).position(|w| w == &b"\r\n\r\n"[..]) else {
                    continue;
                };
                let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
                let declared = head
                    .lines()
                    .filter_map(|l| l.split_once(':'))
                    .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, v)| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if raw.len() >= head_end + 4 + declared {
                    break;
                }
            }
            *sink_seen.lock().unwrap() = String::from_utf8_lossy(&raw).to_string();
            let response = format!("HTTP/1.1 {status}\r\n{extra_headers}Content-Length: 0\r\n\r\n");
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        });
        (port, seen)
    }

    fn sink_config(port: u16, format: &str) -> WebhookConfig {
        WebhookConfig {
            url: format!("http://127.0.0.1:{port}/hook?token=super-secret"),
            format: format.into(),
            headers: vec![("Authorization".into(), "Bearer local-only".into())],
        }
    }

    #[tokio::test]
    async fn posts_json_envelope_with_headers_to_a_local_endpoint() {
        let (port, seen) = spawn_sink("200 OK", "");
        let config = sink_config(port, "json");
        let body = encode_body(&config, "sensor/1", &Bytes::from_static(b"{\"t\":1}"), 1, false);
        deliver(&client().unwrap(), &config, body).await.expect("2xx is success");

        let request = seen.lock().unwrap().clone();
        assert!(request.starts_with("POST /hook?token=super-secret HTTP/1.1"), "{request}");
        assert!(request.contains("content-type: application/json"), "{request}");
        assert!(request.contains("authorization: Bearer local-only"), "{request}");
        assert!(request.contains("\"topic\":\"sensor/1\""), "{request}");
        assert!(request.contains("\"payload\":\"{\\\"t\\\":1}\""), "{request}");
    }

    #[tokio::test]
    async fn raw_format_posts_the_transformed_bytes_verbatim() {
        let (port, seen) = spawn_sink("201 Created", "");
        let config = sink_config(port, "raw");
        let payload = Bytes::from_static(b"alert: temperature 51");
        deliver(&client().unwrap(), &config, encode_body(&config, "a/b", &payload, 0, false))
            .await
            .expect("2xx is a success");
        let request = seen.lock().unwrap().clone();
        let expected_body = String::from_utf8_lossy(&payload).to_string();
        assert!(request.ends_with(&expected_body), "{request}");
        assert!(request.contains("content-type: application/octet-stream"), "{request}");
    }

    #[tokio::test]
    async fn non_2xx_and_redirects_are_errors_without_leaking_the_url() {
        for (status, extra) in [("500 Internal Server Error", ""), ("302 Found", "Location: http://127.0.0.1:9/x\r\n")] {
            let (port, _seen) = spawn_sink(status, extra);
            let config = sink_config(port, "json");
            let error = deliver(&client().unwrap(), &config, encode_body(&config, "a/b", &Bytes::from_static(b"x"), 1, false))
                .await
                .expect_err("only 2xx counts as delivered");
            assert!(error.starts_with("HTTP "), "{error}");
            assert!(!error.contains("super-secret"), "errors must not carry the token: {error}");
            assert!(!error.contains("/hook"), "errors must not carry the path: {error}");
        }
    }

    #[tokio::test]
    async fn unreachable_endpoint_fails_fast_and_stays_redacted() {
        // Binding then dropping frees the port, so the connect is refused.
        let dead_port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let config = sink_config(dead_port, "json");
        let error = deliver(&client().unwrap(), &config, Bytes::from_static(b"x"))
            .await
            .expect_err("refused connection must surface");
        assert!(!error.contains("super-secret"), "token must not leak: {error}");
        assert!(!error.contains("/hook"), "path must not leak: {error}");
    }
}
