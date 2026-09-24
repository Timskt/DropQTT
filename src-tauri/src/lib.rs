pub mod bridge;
pub mod history;
pub mod mqtt_manager;
pub mod protocol;
pub mod transport;
pub mod transform;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::bridge::{BridgeManager, BridgeRule};
use crate::mqtt_manager::MqttManager;
use crate::protocol::{BrokerConfig, ConnectionStatus, ConsolePublishParams};

pub struct AppState {
    pub mqtt: Arc<MqttManager>,
    pub bridge: Arc<BridgeManager>,
}

#[tauri::command]
async fn get_default_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    let dir = state.mqtt.get_download_dir().await;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn set_download_dir(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    // Only accept an existing directory — reject traversal to arbitrary targets.
    if !p.is_dir() {
        return Err("Download path must be an existing directory".to_string());
    }
    state.mqtt.set_download_dir(p).await;
    Ok(())
}

/// Stat a local file's size (used by the batch sender to show real totals).
#[tauri::command]
async fn file_size(path: String) -> Result<u64, String> {
    let md = std::fs::metadata(&path).map_err(|e| format!("stat failed: {e}"))?;
    if !md.is_file() {
        return Err("path is not a regular file".to_string());
    }
    Ok(md.len())
}

#[tauri::command]
async fn connect_broker(
    app: AppHandle,
    state: State<'_, AppState>,
    config: BrokerConfig,
) -> Result<(), String> {
    let manager = state.mqtt.clone();
    manager.connect(app, config).await
}

#[tauri::command]
async fn disconnect_broker(state: State<'_, AppState>) -> Result<(), String> {
    state.mqtt.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn test_broker_connection(config: BrokerConfig) -> Result<u64, String> {
    MqttManager::test_connection(config).await
}

#[tauri::command]
async fn get_connection_status(state: State<'_, AppState>) -> Result<ConnectionStatus, String> {
    Ok(state.mqtt.get_connection_status().await)
}

#[tauri::command]
async fn start_send_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    chunk_size: usize,
    qos: u8,
    custom_publish_topic: Option<String>,
) -> Result<String, String> {
    let p = std::path::Path::new(&file_path);
    // Reject non-existent / non-regular-file targets before touching the wire.
    if !p.is_file() {
        return Err("File to send does not exist".to_string());
    }
    let manager = state.mqtt.clone();
    manager
        .send_file(app, file_path, chunk_size, qos, custom_publish_topic)
        .await
}

#[tauri::command]
async fn pause_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.mqtt.pause_transfer(&transfer_id).await;
    Ok(())
}

#[tauri::command]
async fn resume_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.mqtt.resume_transfer(&transfer_id).await;
    Ok(())
}

#[tauri::command]
async fn cancel_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.mqtt.cancel_transfer(&transfer_id).await;
    Ok(())
}

#[tauri::command]
async fn subscribe_topic(
    state: State<'_, AppState>,
    topic: String,
    qos: u8,
) -> Result<(), String> {
    state.mqtt.subscribe_topic(topic, qos).await
}

#[tauri::command]
async fn unsubscribe_topic(
    state: State<'_, AppState>,
    topic: String,
) -> Result<(), String> {
    state.mqtt.unsubscribe_topic(topic).await
}

#[tauri::command]
async fn get_subscription_stats(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, u64>, String> {
    Ok(state.mqtt.get_subscription_stats().await)
}

#[tauri::command]
async fn reset_subscription_stats(state: State<'_, AppState>) -> Result<(), String> {
    state.mqtt.reset_subscription_stats().await;
    Ok(())
}

/// Live per-topic traffic table (count / bytes / msgs-per-sec), hottest first
#[tauri::command]
async fn get_topic_stats(
    state: State<'_, AppState>,
) -> Result<Vec<mqtt_manager::TopicStatRow>, String> {
    Ok(state.mqtt.get_topic_stats().await)
}

#[tauri::command]
async fn reset_topic_stats(state: State<'_, AppState>) -> Result<(), String> {
    state.mqtt.reset_topic_stats().await;
    Ok(())
}

/// Runtime-configurable topic tracking cap (platforms with 10k+ topics)
#[tauri::command]
async fn set_topic_stats_cap(state: State<'_, AppState>, cap: usize) -> Result<(), String> {
    state.mqtt.set_topic_stats_cap(cap);
    Ok(())
}

#[tauri::command]
async fn get_topic_stats_cap(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.mqtt.get_topic_stats_cap())
}

/// Broker `$SYS` health metrics (version / uptime / connections / msg rates)
#[tauri::command]
async fn get_broker_sys(state: State<'_, AppState>) -> Result<Vec<mqtt_manager::SysRow>, String> {
    Ok(state.mqtt.get_broker_sys().await)
}

#[tauri::command]
async fn clear_broker_sys(state: State<'_, AppState>) -> Result<(), String> {
    state.mqtt.clear_broker_sys().await;
    Ok(())
}

/// Search persisted message history (SQLite) by topic/payload text + direction
#[tauri::command]
async fn query_history(
    state: State<'_, AppState>,
    search: String,
    direction: String,
    limit: i64,
) -> Result<Vec<history::HistoryRow>, String> {
    Ok(state.mqtt.query_history(&search, &direction, limit).await)
}

/// Per-bucket message counts for the history trend chart
#[tauri::command]
async fn history_series(
    state: State<'_, AppState>,
    topic: String,
    bucket_ms: i64,
    since_ms: i64,
) -> Result<Vec<history::HistorySeriesPoint>, String> {
    Ok(state.mqtt.history_series(&topic, bucket_ms, since_ms).await)
}

#[tauri::command]
async fn history_stats(state: State<'_, AppState>) -> Result<history::HistoryStats, String> {
    Ok(state.mqtt.history_stats().await)
}

#[tauri::command]
async fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    state.mqtt.clear_history().await;
    Ok(())
}

/// Built-in publish stress generator (loops back through our own subscription,
/// exercising the batched feed + traffic stats under real load)
#[tauri::command]
async fn start_bench(
    app: AppHandle,
    state: State<'_, AppState>,
    topic: String,
    rate: u32,
    size: u32,
    duration: u32,
) -> Result<(), String> {
    state.mqtt.start_bench(app, topic, rate, size, duration).await
}

#[tauri::command]
async fn publish_console(
    app: AppHandle,
    state: State<'_, AppState>,
    params: ConsolePublishParams,
) -> Result<(), String> {
    state.mqtt.publish_console(app, params).await
}

#[tauri::command]
async fn approve_transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    state.mqtt.approve_transfer(app, transfer_id).await
}

#[tauri::command]
async fn reject_transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    state.mqtt.reject_transfer(app, transfer_id).await
}

#[tauri::command]
async fn set_auto_receive(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.mqtt.set_auto_receive(enabled);
    Ok(())
}

// ---------------------------------------------------------------------
// Bridge (broker-to-broker forwarding) commands
// ---------------------------------------------------------------------

#[tauri::command]
async fn bridge_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    config: BrokerConfig,
) -> Result<(), String> {
    state.bridge.clone().connect(app, id, config).await
}

#[tauri::command]
async fn bridge_disconnect(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.bridge.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
async fn bridge_status(
    state: State<'_, AppState>,
) -> Result<Vec<bridge::BridgeConnInfo>, String> {
    Ok(state.bridge.bridge_status().await)
}

#[tauri::command]
async fn bridge_sync_rules(
    app: AppHandle,
    state: State<'_, AppState>,
    rules: Vec<BridgeRule>,
) -> Result<(), String> {
    state.bridge.clone().sync_rules(app, rules).await
}

#[tauri::command]
async fn bridge_stats(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, bridge::BridgeRuleStats>, String> {
    Ok(state.bridge.stats().await)
}

#[tauri::command]
async fn bridge_reset_stats(state: State<'_, AppState>) -> Result<(), String> {
    state.bridge.reset_stats().await;
    Ok(())
}

/// Dry-run a rule transform script against a sample payload (no forwarding,
/// no connection required) — backs the rule editor's "run test" panel.
#[tauri::command]
async fn bridge_test_transform(
    script: String,
    topic: String,
    payload_base64: String,
) -> Result<serde_json::Value, String> {
    use base64::Engine;
    use bytes::Bytes;
    let trimmed = script.trim();
    if trimmed.is_empty() {
        return Err("script is empty".to_string());
    }
    if !trimmed.contains("function transform") {
        return Err("script must define function transform(topic, payload, qos, retain)".to_string());
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(payload_base64.as_bytes())
        .map_err(|e| format!("invalid base64: {}", e))?;
    match transform::apply_transform(trimmed, &topic, &Bytes::from(raw), 1, false) {
        Ok(transform::TransformOutcome::Send(b)) => Ok(serde_json::json!({
            "action": "send",
            "payload": String::from_utf8_lossy(&b).to_string(),
            "bytes": b.len(),
        })),
        Ok(transform::TransformOutcome::Drop) => Ok(serde_json::json!({ "action": "drop" })),
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn reveal_file(app: AppHandle, file_path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }
    let target = path.parent().unwrap_or(path).to_string_lossy().to_string();
    app.opener()
        .open_path(&target, None::<&str>)
        .map_err(|e| format!("Failed to reveal: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mqtt_manager = Arc::new(MqttManager::new());
    let bridge_manager = BridgeManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            mqtt: mqtt_manager,
            bridge: bridge_manager,
        })
        .setup(|app| {
            // Open the persistent message-history DB under app data dir and
            // attach it to the MQTT manager (best-effort; failure is non-fatal).
            match app.path().app_data_dir() {
                Ok(data_dir) => {
                    let _ = std::fs::create_dir_all(&data_dir);
                    let db_path = data_dir.join("dropqtt_history.db");
                    match history::HistoryStore::open(&db_path) {
                        Ok(store) => app.state::<AppState>().mqtt.attach_history(Arc::new(store)),
                        Err(e) => eprintln!("[dropqtt] history store unavailable: {e}"),
                    }
                }
                Err(e) => eprintln!("[dropqtt] app data dir unavailable: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_default_download_dir,
            set_download_dir,
            file_size,
            connect_broker,
            disconnect_broker,
            test_broker_connection,
            get_connection_status,
            start_send_file,
            pause_transfer,
            resume_transfer,
            cancel_transfer,
            subscribe_topic,
            unsubscribe_topic,
            get_subscription_stats,
            reset_subscription_stats,
            get_topic_stats,
            reset_topic_stats,
            get_broker_sys,
            clear_broker_sys,
            query_history,
            history_series,
            history_stats,
            clear_history,
            set_topic_stats_cap,
            get_topic_stats_cap,
            start_bench,
            publish_console,
            approve_transfer,
            reject_transfer,
            set_auto_receive,
            reveal_file,
            bridge_connect,
            bridge_disconnect,
            bridge_status,
            bridge_sync_rules,
            bridge_stats,
            bridge_reset_stats,
            bridge_test_transform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
