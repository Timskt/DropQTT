use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerConfig {
    pub host: String,
    pub port: u16,
    pub use_tls: bool,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub keep_alive_secs: u64,
    pub default_qos: u8,
    pub base_topic: Option<String>,
}

impl Default for BrokerConfig {
    fn default() -> Self {
        let rand_suffix: String = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
        Self {
            host: "broker.emqx.io".to_string(),
            port: 1883,
            use_tls: false,
            client_id: format!("DropQTT_{}", rand_suffix),
            username: None,
            password: None,
            keep_alive_secs: 60,
            default_qos: 1,
            base_topic: Some("dropqtt".to_string()),
        }
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
    pub msg_type: String, // "ACK", "PAUSE", "RESUME", "CANCEL", "COMPLETED", "ERROR"
    pub transfer_id: String,
    pub chunk_index: Option<usize>,
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
    pub status: String, // "transferring", "paused", "verifying", "completed", "cancelled", "failed"
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
    pub channel: String,
    pub client_id: String,
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
    }
}
