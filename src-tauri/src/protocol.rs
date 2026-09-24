use serde::{Deserialize, Serialize};

fn default_protocol_version() -> u8 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerConfig {
    pub host: String,
    pub port: u16,
    pub use_tls: bool,
    /// Route the connection over WebSocket / WSS instead of raw TCP
    #[serde(default)]
    pub use_websocket: bool,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub keep_alive_secs: u64,
    pub default_qos: u8,
    pub base_topic: Option<String>,
    /// 3 => MQTT v3.1.1, 5 => MQTT v5.0
    #[serde(default = "default_protocol_version")]
    pub protocol_version: u8,
    /// MQTT 3.1.1 clean_session / MQTT 5 clean_start
    #[serde(default = "default_clean_session")]
    pub clean_session: bool,
    // ---- Last Will & Testament (LWT) ----
    /// Will topic; when set with a non-empty value a WILL FLAG is sent on CONNECT
    #[serde(default)]
    pub will_topic: Option<String>,
    #[serde(default)]
    pub will_payload: Option<String>,
    #[serde(default)]
    pub will_qos: u8,
    #[serde(default)]
    pub will_retain: bool,
    // ---- mTLS / custom trust ----
    /// PEM CA bundle path for server verification (empty => system root store)
    #[serde(default)]
    pub tls_ca_path: Option<String>,
    /// PEM client certificate path (mutual TLS)
    #[serde(default)]
    pub tls_client_cert_path: Option<String>,
    /// PEM client private key path (mutual TLS)
    #[serde(default)]
    pub tls_client_key_path: Option<String>,
}

fn default_clean_session() -> bool {
    true
}

impl Default for BrokerConfig {
    fn default() -> Self {
        let rand_suffix: String = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
        Self {
            host: "broker.emqx.io".to_string(),
            port: 1883,
            use_tls: false,
            use_websocket: false,
            client_id: format!("DropQTT_{}", rand_suffix),
            username: None,
            password: None,
            keep_alive_secs: 60,
            default_qos: 1,
            base_topic: Some("dropqtt".to_string()),
            protocol_version: 3,
            clean_session: true,
            will_topic: None,
            will_payload: None,
            will_qos: 0,
            will_retain: false,
            tls_ca_path: None,
            tls_client_cert_path: None,
            tls_client_key_path: None,
        }
    }
}

impl BrokerConfig {
    pub fn is_v5(&self) -> bool {
        self.protocol_version == 5
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferMeta {
    pub transfer_id: String,
    pub sender_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub chunk_size: usize,
    pub total_chunks: usize,
    pub sha256: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlMessage {
    #[serde(rename = "type")]
    pub msg_type: String, // "NACK", "COMPLETED", "ERROR", "PAUSE", "RESUME", "CANCEL"
    pub transfer_id: String,
    pub chunk_index: Option<usize>,
    pub missing: Option<Vec<usize>>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub channel: String,
    pub file_name: String,
    pub direction: String, // "send" | "receive"
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub chunks_transferred: usize,
    pub total_chunks: usize,
    pub speed_bps: f64,
    pub status: String, /* "transferring" | "paused" | "verifying" | "awaiting_approval"
                         * | "completed" | "delivered" | "cancelled" | "failed" */
    pub error_message: Option<String>,
    pub sha256: String,
    pub save_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connected: bool,
    pub broker_host: String,
    pub broker_port: u16,
    pub client_id: String,
}

/// MQTT v5 user-facing publish properties (ignored on v3.1.1 connections)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PubProperties {
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub user_properties: Vec<(String, String)>,
    #[serde(default)]
    pub message_expiry: Option<u32>,
    /// MQTT5 Response Topic — for Request/Response (RPC) request messages
    #[serde(default)]
    pub response_topic: Option<String>,
    /// MQTT5 Correlation Data (UTF-8 string on the UI, bytes on the wire)
    #[serde(default)]
    pub correlation_data: Option<String>,
}

/// Console publish request with raw binary payload (base64 on the wire)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolePublishParams {
    pub topic: String,
    pub payload_base64: String,
    pub qos: u8,
    pub retain: bool,
    #[serde(default)]
    pub properties: PubProperties,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttGenericMessage {
    pub id: String,
    pub topic: String,
    pub payload: String,
    pub payload_len: usize,
    /// Raw bytes (base64, possibly truncated for very large payloads) so the
    /// console can render HEX / CBOR / Base64 views losslessly
    pub payload_base64: String,
    pub truncated: bool,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub user_properties: Vec<(String, String)>,
    #[serde(default)]
    pub response_topic: Option<String>,
    #[serde(default)]
    pub correlation_data: Option<String>,
    pub qos: u8,
    pub retain: bool,
    pub timestamp: String,
    /// Epoch milliseconds captured when the app observed/published the message.
    #[serde(default)]
    pub timestamp_ms: i64,
    pub direction: String, // "in" | "out"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicSubscription {
    pub topic: String,
    pub qos: u8,
    pub color: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn test_transfer_meta_serialization() {
        let meta = TransferMeta {
            transfer_id: "test-uuid-123".to_string(),
            sender_id: "client-a".to_string(),
            file_name: "payload.bin".to_string(),
            file_size: 1048576,
            chunk_size: 262144,
            total_chunks: 4,
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
            timestamp: 1726700000,
        };

        let json = serde_json::to_string(&meta).expect("serialize meta");
        assert!(json.contains("test-uuid-123"));
        assert!(json.contains("payload.bin"));

        let deserialized: TransferMeta = serde_json::from_str(&json).expect("deserialize meta");
        assert_eq!(deserialized.total_chunks, 4);
        assert_eq!(deserialized.chunk_size, 262144);
    }

    #[test]
    fn test_sha256_chunk_reconstitution() {
        let chunk1 = b"Hello ";
        let chunk2 = b"MQTT ";
        let chunk3 = b"Transfer!";

        let mut direct_hasher = Sha256::new();
        direct_hasher.update(b"Hello MQTT Transfer!");
        let expected_hash = hex::encode(direct_hasher.finalize());

        let mut streaming_hasher = Sha256::new();
        streaming_hasher.update(chunk1);
        streaming_hasher.update(chunk2);
        streaming_hasher.update(chunk3);
        let actual_hash = hex::encode(streaming_hasher.finalize());

        assert_eq!(expected_hash, actual_hash);
    }

    #[test]
    fn test_broker_config_default() {
        let cfg = BrokerConfig::default();
        assert_eq!(cfg.host, "broker.emqx.io");
        assert_eq!(cfg.port, 1883);
        assert!(!cfg.use_tls);
        assert!(cfg.client_id.starts_with("DropQTT_"));
        assert_eq!(cfg.protocol_version, 3);
        assert!(!cfg.is_v5());
    }

    #[test]
    fn test_broker_config_legacy_json_defaults() {
        // Old persisted configs without protocolVersion/cleanSession must still parse
        let legacy = r#"{"host":"h","port":1883,"useTls":false,"clientId":"c","keepAliveSecs":60,"defaultQos":1}"#;
        let cfg: BrokerConfig = serde_json::from_str(legacy).expect("parse legacy config");
        assert_eq!(cfg.protocol_version, 3);
        assert!(cfg.clean_session);
    }

    #[test]
    fn test_control_message_nack_roundtrip() {
        let ctrl = ControlMessage {
            msg_type: "NACK".to_string(),
            transfer_id: "t1".to_string(),
            chunk_index: None,
            missing: Some(vec![3, 7, 11]),
            message: None,
        };
        let json = serde_json::to_string(&ctrl).unwrap();
        let back: ControlMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back.msg_type, "NACK");
        assert_eq!(back.missing, Some(vec![3, 7, 11]));
    }

    #[test]
    fn test_transfer_control_lifecycle_messages_roundtrip() {
        for msg_type in ["PAUSE", "RESUME", "CANCEL"] {
            let ctrl = ControlMessage {
                msg_type: msg_type.to_string(),
                transfer_id: "t1".to_string(),
                chunk_index: None,
                missing: None,
                message: None,
            };
            let json = serde_json::to_string(&ctrl).expect("serialize control");
            let back: ControlMessage = serde_json::from_str(&json).expect("deserialize control");
            assert_eq!(back.msg_type, msg_type);
            assert_eq!(back.transfer_id, "t1");
        }
    }
}
