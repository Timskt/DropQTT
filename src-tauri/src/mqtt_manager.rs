use std::collections::{HashMap, HashSet};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use bytes::Bytes;
use rumqttc::{AsyncClient, MqttOptions, QoS, Transport};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{Mutex, RwLock};

use crate::protocol::*;

pub struct IncomingTransfer {
    pub meta: TransferMeta,
    pub topic_prefix: String,
    pub temp_path: PathBuf,
    pub final_path: PathBuf,
    pub file: Arc<Mutex<File>>,
    pub received_chunks: HashSet<usize>,
    pub bytes_received: u64,
    pub start_time: Instant,
    pub last_update: Instant,
    pub last_bytes: u64,
}

pub struct ActiveOutgoing {
    pub cancelled: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,
}

pub struct MqttManager {
    client: Arc<Mutex<Option<AsyncClient>>>,
    current_config: Arc<RwLock<Option<BrokerConfig>>>,
    current_channel: Arc<RwLock<String>>,
    base_topic: Arc<RwLock<String>>,
    download_dir: Arc<RwLock<PathBuf>>,
    incoming_transfers: Arc<Mutex<HashMap<String, IncomingTransfer>>>,
    outgoing_transfers: Arc<Mutex<HashMap<String, ActiveOutgoing>>>,
    is_connected: Arc<AtomicBool>,
}

impl MqttManager {
    pub fn new() -> Self {
        let def_download = dirs::download_dir().unwrap_or_else(|| PathBuf::from("./downloads"));
        Self {
            client: Arc::new(Mutex::new(None)),
            current_config: Arc::new(RwLock::new(None)),
            current_channel: Arc::new(RwLock::new("public-lobby".to_string())),
            base_topic: Arc::new(RwLock::new("dropqtt".to_string())),
            download_dir: Arc::new(RwLock::new(def_download)),
            incoming_transfers: Arc::new(Mutex::new(HashMap::new())),
            outgoing_transfers: Arc::new(Mutex::new(HashMap::new())),
            is_connected: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn set_download_dir(&self, path: PathBuf) {
        let mut dir = self.download_dir.write().await;
        *dir = path;
    }

    pub async fn get_download_dir(&self) -> PathBuf {
        self.download_dir.read().await.clone()
    }

    pub async fn get_connection_status(&self) -> ConnectionStatus {
        let connected = self.is_connected.load(Ordering::SeqCst);
        let channel = self.current_channel.read().await.clone();
        let config_guard = self.current_config.read().await;
        if let Some(ref cfg) = *config_guard {
            ConnectionStatus {
                connected,
                broker_host: cfg.host.clone(),
                broker_port: cfg.port,
                channel,
                client_id: cfg.client_id.clone(),
            }
        } else {
            ConnectionStatus {
                connected: false,
                broker_host: "".to_string(),
                broker_port: 1883,
                channel,
                client_id: "".to_string(),
            }
        }
    }

    pub async fn test_connection(config: BrokerConfig) -> Result<u64, String> {
        let rand_suffix: String = uuid::Uuid::new_v4().simple().to_string()[..6].to_string();
        let test_client_id = format!("{}_test_{}", config.client_id, rand_suffix);
        let mut mqttoptions = MqttOptions::new(test_client_id, &config.host, config.port);
        mqttoptions.set_keep_alive(std::time::Duration::from_secs(10));

        if let (Some(u), Some(p)) = (&config.username, &config.password) {
            if !u.is_empty() {
                mqttoptions.set_credentials(u, p);
            }
        }

        if config.use_tls {
            let transport = Transport::tls_with_default_config();
            mqttoptions.set_transport(transport);
        }

        let start = Instant::now();
        let (client, mut eventloop) = AsyncClient::new(mqttoptions, 10);

        let timeout_duration = std::time::Duration::from_secs(6);
        let poll_task = async {
            loop {
                match eventloop.poll().await {
                    Ok(rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(connack))) => {
                        if connack.code == rumqttc::ConnectReturnCode::Success {
                            return Ok(());
                        } else {
                            return Err(format!("ConnAck rejected: {:?}", connack.code));
                        }
                    }
                    Ok(_) => {}
                    Err(e) => return Err(format!("Connection error: {:?}", e)),
                }
            }
        };

        match tokio::time::timeout(timeout_duration, poll_task).await {
            Ok(Ok(_)) => {
                let latency = start.elapsed().as_millis() as u64;
                let _ = client.disconnect().await;
                Ok(latency)
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err("Connection timed out after 6 seconds".to_string()),
        }
    }

    pub async fn connect(&self, app: AppHandle, config: BrokerConfig) -> Result<(), String> {
        self.disconnect().await;

        let mut mqttoptions = MqttOptions::new(&config.client_id, &config.host, config.port);
        mqttoptions.set_keep_alive(std::time::Duration::from_secs(config.keep_alive_secs));
        mqttoptions.set_max_packet_size(10 * 1024 * 1024, 10 * 1024 * 1024); // 10MB packet support

        if let (Some(u), Some(p)) = (&config.username, &config.password) {
            if !u.is_empty() {
                mqttoptions.set_credentials(u, p);
            }
        }

        if config.use_tls {
            let transport = Transport::tls_with_default_config();
            mqttoptions.set_transport(transport);
        }

        let (client, mut eventloop) = AsyncClient::new(mqttoptions, 100);

        *self.client.lock().await = Some(client.clone());
        *self.current_config.write().await = Some(config.clone());

        let base_topic = config.base_topic.clone().unwrap_or_else(|| "dropqtt".to_string());
        *self.base_topic.write().await = base_topic.clone();

        let channel = self.current_channel.read().await.clone();
        let channel_sub = format!("{}/{}/#", base_topic, channel);

        // Subscribe to channel topic
        let qos = match config.default_qos {
            0 => QoS::AtMostOnce,
            2 => QoS::ExactlyOnce,
            _ => QoS::AtLeastOnce,
        };

        if let Err(e) = client.subscribe(&channel_sub, qos).await {
            return Err(format!("Failed to subscribe to channel {}: {:?}", channel, e));
        }

        self.is_connected.store(true, Ordering::SeqCst);
        let _ = app.emit("broker-status", self.get_connection_status().await);

        // Spawn eventloop listener
        let is_connected_flag = self.is_connected.clone();
        let incoming_map = self.incoming_transfers.clone();
        let download_dir_ref = self.download_dir.clone();
        let client_clone = client.clone();
        let app_handle = app.clone();
        let my_client_id = config.client_id.clone();

        tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(notification) => {
                        if let rumqttc::Event::Incoming(rumqttc::Packet::Publish(publish)) = notification {
                            let topic = publish.topic.clone();
                            let payload = publish.payload.clone();

                            // If not a raw binary chunk packet, emit generic message event for MQTTX console
                            if !topic.contains("/chunk/") {
                                let payload_str = String::from_utf8_lossy(&payload).to_string();
                                let msg = MqttGenericMessage {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    topic: topic.clone(),
                                    payload: payload_str,
                                    payload_len: payload.len(),
                                    qos: match publish.qos {
                                        rumqttc::QoS::AtMostOnce => 0,
                                        rumqttc::QoS::AtLeastOnce => 1,
                                        rumqttc::QoS::ExactlyOnce => 2,
                                    },
                                    retain: publish.retain,
                                    timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                                    direction: "in".to_string(),
                                };
                                let _ = app_handle.emit("mqtt-message", msg);
                            }

                            Self::handle_incoming_packet(
                                &app_handle,
                                &topic,
                                payload,
                                &incoming_map,
                                &download_dir_ref,
                                &client_clone,
                                &my_client_id,
                            ).await;
                        }
                    }
                    Err(e) => {
                        eprintln!("MQTT connection event error: {:?}", e);
                        is_connected_flag.store(false, Ordering::SeqCst);
                        let _ = app_handle.emit("broker-disconnected", format!("{:?}", e));
                        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                    }
                }
            }
        });

        Ok(())
    }

    pub async fn disconnect(&self) {
        let mut client_guard = self.client.lock().await;
        if let Some(client) = client_guard.take() {
            let _ = client.disconnect().await;
        }
        self.is_connected.store(false, Ordering::SeqCst);
    }

    pub async fn join_channel(&self, app: AppHandle, new_channel: String) -> Result<(), String> {
        let old_channel = self.current_channel.read().await.clone();
        let base_topic = self.base_topic.read().await.clone();
        let client_guard = self.client.lock().await;

        if let Some(client) = client_guard.as_ref() {
            let old_sub = format!("{}/{}/#", base_topic, old_channel);
            let _ = client.unsubscribe(&old_sub).await;

            let new_sub = format!("{}/{}/#", base_topic, new_channel);
            client
                .subscribe(&new_sub, QoS::AtLeastOnce)
                .await
                .map_err(|e| format!("Failed to subscribe to channel: {:?}", e))?;
        }

        *self.current_channel.write().await = new_channel;
        let _ = app.emit("broker-status", self.get_connection_status().await);
        Ok(())
    }

    pub async fn subscribe_topic(&self, topic: String, qos_val: u8) -> Result<(), String> {
        let client = {
            let client_guard = self.client.lock().await;
            match client_guard.as_ref() {
                Some(c) => c.clone(),
                None => return Err("MQTT client not connected".to_string()),
            }
        };

        let qos = match qos_val {
            0 => QoS::AtMostOnce,
            2 => QoS::ExactlyOnce,
            _ => QoS::AtLeastOnce,
        };

        client
            .subscribe(&topic, qos)
            .await
            .map_err(|e| format!("Failed to subscribe to {}: {:?}", topic, e))?;

        Ok(())
    }

    pub async fn unsubscribe_topic(&self, topic: String) -> Result<(), String> {
        let client = {
            let client_guard = self.client.lock().await;
            match client_guard.as_ref() {
                Some(c) => c.clone(),
                None => return Err("MQTT client not connected".to_string()),
            }
        };

        client
            .unsubscribe(&topic)
            .await
            .map_err(|e| format!("Failed to unsubscribe from {}: {:?}", topic, e))?;

        Ok(())
    }

    pub async fn publish_raw_message(
        &self,
        app: AppHandle,
        topic: String,
        payload: String,
        qos_val: u8,
        retain: bool,
    ) -> Result<(), String> {
        let client = {
            let client_guard = self.client.lock().await;
            match client_guard.as_ref() {
                Some(c) => c.clone(),
                None => return Err("MQTT client not connected".to_string()),
            }
        };

        let qos = match qos_val {
            0 => QoS::AtMostOnce,
            2 => QoS::ExactlyOnce,
            _ => QoS::AtLeastOnce,
        };

        let payload_bytes = payload.as_bytes();
        client
            .publish(&topic, qos, retain, payload_bytes)
            .await
            .map_err(|e| format!("Failed to publish: {:?}", e))?;

        // Emit outgoing message event to frontend
        let msg = MqttGenericMessage {
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.clone(),
            payload: payload.clone(),
            payload_len: payload_bytes.len(),
            qos: qos_val,
            retain,
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            direction: "out".to_string(),
        };
        let _ = app.emit("mqtt-message", msg);

        Ok(())
    }

    pub async fn pause_transfer(&self, transfer_id: &str) {
        let outgoing = self.outgoing_transfers.lock().await;
        if let Some(trans) = outgoing.get(transfer_id) {
            trans.paused.store(true, Ordering::SeqCst);
        }
    }

    pub async fn resume_transfer(&self, transfer_id: &str) {
        let outgoing = self.outgoing_transfers.lock().await;
        if let Some(trans) = outgoing.get(transfer_id) {
            trans.paused.store(false, Ordering::SeqCst);
        }
    }

    pub async fn cancel_transfer(&self, transfer_id: &str) {
        let outgoing = self.outgoing_transfers.lock().await;
        if let Some(trans) = outgoing.get(transfer_id) {
            trans.cancelled.store(true, Ordering::SeqCst);
        }
    }

    pub async fn send_file(
        &self,
        app: AppHandle,
        file_path_str: String,
        chunk_size: usize,
        qos_val: u8,
        custom_publish_topic: Option<String>,
    ) -> Result<String, String> {
        let path = PathBuf::from(&file_path_str);
        if !path.exists() {
            return Err("Selected file does not exist".to_string());
        }

        let file_meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| format!("Cannot read file metadata: {}", e))?;
        let file_size = file_meta.len();

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown_file")
            .to_string();

        let chunk_size = chunk_size.clamp(16 * 1024, 4 * 1024 * 1024);
        let total_chunks = if file_size == 0 {
            1
        } else {
            ((file_size + chunk_size as u64 - 1) / chunk_size as u64) as usize
        };

        let transfer_id = uuid::Uuid::new_v4().to_string();
        let channel = self.current_channel.read().await.clone();
        let base_topic = self.base_topic.read().await.clone();

        // Determine topic prefix (either custom publish topic or standard base_topic/channel)
        let topic_prefix = match custom_publish_topic {
            Some(ref t) if !t.trim().is_empty() => {
                let mut clean = t.trim().trim_end_matches('/').to_string();
                if clean.ends_with("/meta") {
                    clean = clean.strip_suffix("/meta").unwrap_or(&clean).to_string();
                } else if clean.ends_with("/#") {
                    clean = clean.strip_suffix("/#").unwrap_or(&clean).to_string();
                }
                clean
            }
            _ => format!("{}/{}", base_topic, channel),
        };

        let client = {
            let client_guard = self.client.lock().await;
            match client_guard.as_ref() {
                Some(c) => c.clone(),
                None => return Err("MQTT client not connected".to_string()),
            }
        };

        let client_id = {
            let cfg = self.current_config.read().await;
            cfg.as_ref().map(|c| c.client_id.clone()).unwrap_or_default()
        };

        // 1. Compute SHA-256
        let _ = app.emit(
            "transfer-progress",
            TransferProgress {
                transfer_id: transfer_id.clone(),
                channel: topic_prefix.clone(),
                file_name: file_name.clone(),
                direction: "send".to_string(),
                bytes_transferred: 0,
                total_bytes: file_size,
                chunks_transferred: 0,
                total_chunks,
                speed_bps: 0.0,
                status: "verifying".to_string(),
                error_message: None,
                sha256: "".to_string(),
                save_path: Some(file_path_str.clone()),
            },
        );

        let mut hasher = Sha256::new();
        let mut f = File::open(&path)
            .await
            .map_err(|e| format!("Failed to open file: {}", e))?;
        let mut buffer = vec![0u8; 128 * 1024];
        loop {
            let n = f
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Failed to read file for hashing: {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        let sha256_hash = hex::encode(hasher.finalize());

        let meta = TransferMeta {
            transfer_id: transfer_id.clone(),
            sender_id: client_id,
            file_name: file_name.clone(),
            file_size,
            chunk_size,
            total_chunks,
            sha256: sha256_hash.clone(),
            timestamp: chrono::Utc::now().timestamp(),
        };

        let meta_topic = format!("{}/meta", topic_prefix);
        let meta_payload = serde_json::to_vec(&meta).map_err(|e| e.to_string())?;

        let qos = match qos_val {
            0 => QoS::AtMostOnce,
            2 => QoS::ExactlyOnce,
            _ => QoS::AtLeastOnce,
        };

        client
            .publish(&meta_topic, qos, false, meta_payload)
            .await
            .map_err(|e| format!("Failed to publish meta: {:?}", e))?;

        // Register outgoing transfer controls
        let cancelled = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        {
            let mut outgoing = self.outgoing_transfers.lock().await;
            outgoing.insert(
                transfer_id.clone(),
                ActiveOutgoing {
                    cancelled: cancelled.clone(),
                    paused: paused.clone(),
                },
            );
        }

        // Spawn chunk streaming task
        let app_handle = app.clone();
        let tid = transfer_id.clone();
        let ch = topic_prefix.clone();
        let fname = file_name.clone();
        let hash = sha256_hash.clone();
        let fpath = file_path_str.clone();
        let prefix_for_chunks = topic_prefix.clone();

        tokio::spawn(async move {
            let mut file = match File::open(&path).await {
                Ok(f) => f,
                Err(e) => {
                    let _ = app_handle.emit(
                        "transfer-progress",
                        TransferProgress {
                            transfer_id: tid,
                            channel: ch,
                            file_name: fname,
                            direction: "send".to_string(),
                            bytes_transferred: 0,
                            total_bytes: file_size,
                            chunks_transferred: 0,
                            total_chunks,
                            speed_bps: 0.0,
                            status: "failed".to_string(),
                            error_message: Some(format!("Failed to open file: {}", e)),
                            sha256: hash,
                            save_path: Some(fpath),
                        },
                    );
                    return;
                }
            };

            let mut chunk_buf = vec![0u8; chunk_size];
            let mut bytes_sent: u64 = 0;
            let mut last_instant = Instant::now();
            let mut last_bytes: u64 = 0;

            for chunk_idx in 0..total_chunks {
                // Check cancellation
                if cancelled.load(Ordering::SeqCst) {
                    let _ = app_handle.emit(
                        "transfer-progress",
                        TransferProgress {
                            transfer_id: tid.clone(),
                            channel: ch.clone(),
                            file_name: fname.clone(),
                            direction: "send".to_string(),
                            bytes_transferred: bytes_sent,
                            total_bytes: file_size,
                            chunks_transferred: chunk_idx,
                            total_chunks,
                            speed_bps: 0.0,
                            status: "cancelled".to_string(),
                            error_message: Some("Transfer cancelled by sender".to_string()),
                            sha256: hash.clone(),
                            save_path: Some(fpath.clone()),
                        },
                    );
                    return;
                }

                // Check pause
                while paused.load(Ordering::SeqCst) {
                    let _ = app_handle.emit(
                        "transfer-progress",
                        TransferProgress {
                            transfer_id: tid.clone(),
                            channel: ch.clone(),
                            file_name: fname.clone(),
                            direction: "send".to_string(),
                            bytes_transferred: bytes_sent,
                            total_bytes: file_size,
                            chunks_transferred: chunk_idx,
                            total_chunks,
                            speed_bps: 0.0,
                            status: "paused".to_string(),
                            error_message: None,
                            sha256: hash.clone(),
                            save_path: Some(fpath.clone()),
                        },
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    if cancelled.load(Ordering::SeqCst) {
                        return;
                    }
                }

                // Read chunk
                let to_read = if chunk_idx == total_chunks - 1 {
                    let rem = (file_size - bytes_sent) as usize;
                    if rem == 0 {
                        0
                    } else {
                        rem
                    }
                } else {
                    chunk_size
                };

                let read_bytes = if to_read > 0 {
                    match file.read_exact(&mut chunk_buf[..to_read]).await {
                        Ok(n) => n,
                        Err(e) => {
                            eprintln!("Error reading chunk {}: {:?}", chunk_idx, e);
                            return;
                        }
                    }
                } else {
                    0
                };

                let chunk_topic = format!("{}/chunk/{}/{}", prefix_for_chunks, tid, chunk_idx);
                let payload = Bytes::copy_from_slice(&chunk_buf[..read_bytes]);

                if let Err(e) = client.publish(&chunk_topic, qos, false, payload).await {
                    eprintln!("Publish chunk error: {:?}", e);
                }

                bytes_sent += read_bytes as u64;

                // Speed calculation
                let elapsed = last_instant.elapsed().as_secs_f64();
                let speed = if elapsed >= 0.2 {
                    let s = ((bytes_sent - last_bytes) as f64) / elapsed;
                    last_instant = Instant::now();
                    last_bytes = bytes_sent;
                    s
                } else {
                    ((bytes_sent - last_bytes) as f64) / elapsed.max(0.001)
                };

                // Emit progress
                let _ = app_handle.emit(
                    "transfer-progress",
                    TransferProgress {
                        transfer_id: tid.clone(),
                        channel: ch.clone(),
                        file_name: fname.clone(),
                        direction: "send".to_string(),
                        bytes_transferred: bytes_sent,
                        total_bytes: file_size,
                        chunks_transferred: chunk_idx + 1,
                        total_chunks,
                        speed_bps: speed,
                        status: if chunk_idx + 1 == total_chunks {
                            "completed".to_string()
                        } else {
                            "transferring".to_string()
                        },
                        error_message: None,
                        sha256: hash.clone(),
                        save_path: Some(fpath.clone()),
                    },
                );

                // Small pacing to avoid choking loop buffer on large files
                if chunk_size > 256 * 1024 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
                }
            }
        });

        Ok(transfer_id)
    }

    async fn handle_incoming_packet(
        app: &AppHandle,
        topic: &str,
        payload: Bytes,
        incoming_map: &Arc<Mutex<HashMap<String, IncomingTransfer>>>,
        download_dir_ref: &Arc<RwLock<PathBuf>>,
        client: &AsyncClient,
        my_client_id: &str,
    ) {
        // 1. Meta packet: {prefix}/meta
        if topic.ends_with("/meta") {
            let topic_prefix = topic.strip_suffix("/meta").unwrap_or(topic).to_string();
            if let Ok(meta) = serde_json::from_slice::<TransferMeta>(&payload) {
                // Ignore self-sent transfers
                if meta.sender_id == my_client_id {
                    return;
                }

                let download_dir = download_dir_ref.read().await.clone();
                let _ = tokio::fs::create_dir_all(&download_dir).await;

                let temp_filename = format!(".dropqtt_{}.tmp", meta.transfer_id);
                let temp_path = download_dir.join(temp_filename);
                let final_path = Self::get_unique_path(&download_dir, &meta.file_name);

                let file = match File::create(&temp_path).await {
                    Ok(f) => Arc::new(Mutex::new(f)),
                    Err(e) => {
                        eprintln!("Failed to create temp file {:?}: {:?}", temp_path, e);
                        return;
                    }
                };

                let mut incoming = incoming_map.lock().await;
                incoming.insert(
                    meta.transfer_id.clone(),
                    IncomingTransfer {
                        meta: meta.clone(),
                        topic_prefix: topic_prefix.clone(),
                        temp_path: temp_path.clone(),
                        final_path: final_path.clone(),
                        file,
                        received_chunks: HashSet::new(),
                        bytes_received: 0,
                        start_time: Instant::now(),
                        last_update: Instant::now(),
                        last_bytes: 0,
                    },
                );

                let _ = app.emit(
                    "transfer-progress",
                    TransferProgress {
                        transfer_id: meta.transfer_id.clone(),
                        channel: topic_prefix,
                        file_name: meta.file_name.clone(),
                        direction: "receive".to_string(),
                        bytes_transferred: 0,
                        total_bytes: meta.file_size,
                        chunks_transferred: 0,
                        total_chunks: meta.total_chunks,
                        speed_bps: 0.0,
                        status: "transferring".to_string(),
                        error_message: None,
                        sha256: meta.sha256.clone(),
                        save_path: Some(final_path.to_string_lossy().to_string()),
                    },
                );
            }
            return;
        }

        // 2. Chunk packet: {prefix}/chunk/{transfer_id}/{chunk_index}
        if let Some((_topic_prefix, chunk_tail)) = topic.split_once("/chunk/") {
            let parts: Vec<&str> = chunk_tail.split('/').collect();
            if parts.len() >= 2 {
                let transfer_id = parts[0];
                let chunk_idx: usize = match parts[1].parse() {
                    Ok(idx) => idx,
                    Err(_) => return,
                };

                let mut incoming = incoming_map.lock().await;
                if let Some(trans) = incoming.get_mut(transfer_id) {
                    if !trans.received_chunks.contains(&chunk_idx) {
                        let offset = (chunk_idx * trans.meta.chunk_size) as u64;
                        let payload_len = payload.len();

                        {
                            let mut f = trans.file.lock().await;
                            let _ = f.seek(SeekFrom::Start(offset)).await;
                            if let Err(e) = f.write_all(&payload).await {
                                eprintln!("Failed to write chunk {}: {:?}", chunk_idx, e);
                                return;
                            }
                        }

                        trans.received_chunks.insert(chunk_idx);
                        trans.bytes_received += payload_len as u64;

                        // Speed calculation
                        let elapsed = trans.last_update.elapsed().as_secs_f64();
                        let speed = if elapsed >= 0.2 {
                            let s = ((trans.bytes_received - trans.last_bytes) as f64) / elapsed;
                            trans.last_update = Instant::now();
                            trans.last_bytes = trans.bytes_received;
                            s
                        } else {
                            ((trans.bytes_received - trans.last_bytes) as f64) / elapsed.max(0.001)
                        };

                        let is_completed = trans.received_chunks.len() >= trans.meta.total_chunks;

                        let _ = app.emit(
                            "transfer-progress",
                            TransferProgress {
                                transfer_id: trans.meta.transfer_id.clone(),
                                channel: trans.topic_prefix.clone(),
                                file_name: trans.meta.file_name.clone(),
                                direction: "receive".to_string(),
                                bytes_transferred: trans.bytes_received,
                                total_bytes: trans.meta.file_size,
                                chunks_transferred: trans.received_chunks.len(),
                                total_chunks: trans.meta.total_chunks,
                                speed_bps: speed,
                                status: if is_completed {
                                    "verifying".to_string()
                                } else {
                                    "transferring".to_string()
                                },
                                error_message: None,
                                sha256: trans.meta.sha256.clone(),
                                save_path: Some(trans.final_path.to_string_lossy().to_string()),
                            },
                        );

                        // If all chunks received, verify and finalize
                        if is_completed {
                            {
                                let mut f = trans.file.lock().await;
                                let _ = f.flush().await;
                                let _ = f.sync_all().await;
                            }

                            // Compute SHA-256 verification
                            let temp_path = trans.temp_path.clone();
                            let final_path = trans.final_path.clone();
                            let expected_hash = trans.meta.sha256.clone();
                            let meta_clone = trans.meta.clone();
                            let topic_prefix_clone = trans.topic_prefix.clone();

                            let app_handle_inner = app.clone();
                            let client_inner = client.clone();

                            tokio::spawn(async move {
                                let verified = match Self::verify_sha256(&temp_path, &expected_hash).await {
                                    Ok(v) => v,
                                    Err(e) => {
                                        eprintln!("SHA-256 verification error: {:?}", e);
                                        false
                                    }
                                };

                                if verified {
                                    // Rename temp to final
                                    if let Err(e) = tokio::fs::rename(&temp_path, &final_path).await {
                                        eprintln!("Failed to rename temp file: {:?}", e);
                                    }

                                    // Send ACK/COMPLETED control packet
                                    let ctrl = ControlMessage {
                                        msg_type: "COMPLETED".to_string(),
                                        transfer_id: meta_clone.transfer_id.clone(),
                                        chunk_index: None,
                                        message: Some("Verified and saved successfully".to_string()),
                                    };
                                    let ctrl_topic = format!("{}/ctrl/{}", topic_prefix_clone, meta_clone.transfer_id);
                                    if let Ok(ctrl_payload) = serde_json::to_vec(&ctrl) {
                                        let _ = client_inner
                                            .publish(&ctrl_topic, QoS::AtLeastOnce, false, ctrl_payload)
                                            .await;
                                    }

                                    let _ = app_handle_inner.emit(
                                        "transfer-progress",
                                        TransferProgress {
                                            transfer_id: meta_clone.transfer_id.clone(),
                                            channel: topic_prefix_clone,
                                            file_name: meta_clone.file_name.clone(),
                                            direction: "receive".to_string(),
                                            bytes_transferred: meta_clone.file_size,
                                            total_bytes: meta_clone.file_size,
                                            chunks_transferred: meta_clone.total_chunks,
                                            total_chunks: meta_clone.total_chunks,
                                            speed_bps: 0.0,
                                            status: "completed".to_string(),
                                            error_message: None,
                                            sha256: meta_clone.sha256.clone(),
                                            save_path: Some(final_path.to_string_lossy().to_string()),
                                        },
                                    );
                                } else {
                                    let _ = app_handle_inner.emit(
                                        "transfer-progress",
                                        TransferProgress {
                                            transfer_id: meta_clone.transfer_id.clone(),
                                            channel: topic_prefix_clone,
                                            file_name: meta_clone.file_name.clone(),
                                            direction: "receive".to_string(),
                                            bytes_transferred: meta_clone.file_size,
                                            total_bytes: meta_clone.file_size,
                                            chunks_transferred: meta_clone.total_chunks,
                                            total_chunks: meta_clone.total_chunks,
                                            speed_bps: 0.0,
                                            status: "failed".to_string(),
                                            error_message: Some("SHA-256 integrity check failed!".to_string()),
                                            sha256: meta_clone.sha256.clone(),
                                            save_path: Some(temp_path.to_string_lossy().to_string()),
                                        },
                                    );
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    async fn verify_sha256(path: &Path, expected_hex: &str) -> Result<bool, std::io::Error> {
        let mut file = File::open(path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 128 * 1024];

        loop {
            let n = file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }

        let calculated = hex::encode(hasher.finalize());
        Ok(calculated.eq_ignore_ascii_case(expected_hex))
    }

    fn get_unique_path(dir: &Path, file_name: &str) -> PathBuf {
        let target = dir.join(file_name);
        if !target.exists() {
            return target;
        }

        let stem = Path::new(file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = Path::new(file_name)
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();

        let mut counter = 1;
        loop {
            let candidate = dir.join(format!("{}_{}{}", stem, counter, ext));
            if !candidate.exists() {
                return candidate;
            }
            counter += 1;
        }
    }
}
