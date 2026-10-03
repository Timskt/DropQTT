pub mod bridge;
pub mod bench;
pub mod acks;
pub mod assertions;
pub mod diagnostics;
pub mod faults;
pub mod history;
pub mod mqtt_manager;
pub mod protocol;
pub mod rpc;
pub mod responder;
pub mod scheduler;
pub mod silence;
pub mod transport;
pub mod topic;
pub mod transform;
pub mod webhook;

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

/// Sanitized runtime snapshot for the operations workspace and support reports.
#[tauri::command]
async fn get_diagnostics_snapshot(
    state: State<'_, AppState>,
) -> Result<diagnostics::DiagnosticsSnapshot, String> {
    let mqtt = state.mqtt.diagnostics_snapshot().await;
    let bridge = state.bridge.diagnostics_snapshot().await;
    Ok(diagnostics::build_snapshot(mqtt, bridge))
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
    state.mqtt.pause_transfer(&transfer_id).await
}

#[tauri::command]
async fn resume_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<(), String> {
    state.mqtt.resume_transfer(&transfer_id).await
}

#[tauri::command]
async fn cancel_transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    state.mqtt.cancel_transfer(app, transfer_id).await
}

#[tauri::command]
async fn subscribe_topic(
    state: State<'_, AppState>,
    topic: String,
    qos: Option<u8>,
    options: Option<protocol::SubOptions>,
) -> Result<(), String> {
    // `options` supersedes the bare qos; keeping both lets older callers and the
    // v3.1.1 UI path omit it entirely.
    let opts = options.unwrap_or_else(|| protocol::SubOptions {
        qos: qos.unwrap_or(1),
        ..Default::default()
    });
    state.mqtt.subscribe_topic(topic, opts).await
}

#[tauri::command]
async fn unsubscribe_topic(
    state: State<'_, AppState>,
    topic: String,
) -> Result<(), String> {
    state.mqtt.unsubscribe_topic(topic).await
}

/// What the connected broker announced in its CONNACK (v5): QoS ceiling, retain
/// availability, alias limit, packet-size limit, subscription kinds. The forms
/// gate themselves on this so an unsupported request is refused before it can
/// cost the session.
#[tauri::command]
async fn get_broker_capabilities(
    state: State<'_, AppState>,
) -> Result<crate::transport::ConnCapabilities, String> {
    Ok(state.mqtt.broker_capabilities().await)
}

/// Ack verdicts for the subscriptions bar: which filters the broker refuses,
/// which unsubscribes it refused, and which grants it capped at a lower QoS.
#[tauri::command]
async fn get_subscription_ack_state(state: State<'_, AppState>) -> Result<acks::AckState, String> {
    Ok(state.mqtt.sub_ack_state().await)
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

/// Filter -> the Subscription Identifier we asked this broker to label it with.
/// Filters absent from this map have their hits matched locally.
#[tauri::command]
async fn get_subscription_ids(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, u32>, String> {
    Ok(state.mqtt.get_subscription_ids().await)
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
    since_ms: Option<i64>,
    until_ms: Option<i64>,
) -> Result<Vec<history::HistoryRow>, String> {
    state.mqtt.query_history(&search, &direction, limit, since_ms.unwrap_or(0), until_ms.unwrap_or(i64::MAX)).await
}

/// Per-bucket message counts for the history trend chart
#[tauri::command]
async fn history_series(
    state: State<'_, AppState>,
    topic: String,
    direction: Option<String>,
    bucket_ms: i64,
    since_ms: i64,
    until_ms: Option<i64>,
) -> Result<Vec<history::HistorySeriesPoint>, String> {
    state.mqtt.history_series(&topic, direction.as_deref().unwrap_or("all"), bucket_ms, since_ms, until_ms.unwrap_or(i64::MAX)).await
}

/// Per-topic totals over the window the list is showing
#[tauri::command]
async fn history_topics(
    state: State<'_, AppState>,
    search: Option<String>,
    direction: Option<String>,
    since_ms: i64,
    until_ms: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<history::HistoryTopicRow>, String> {
    state
        .mqtt
        .history_topics(
            &search.unwrap_or_default(),
            &direction.unwrap_or_else(|| "all".to_string()),
            since_ms,
            until_ms.unwrap_or(i64::MAX),
            limit.unwrap_or(20),
        )
        .await
}

/// How old history may get before it is trimmed; 0 keeps only the row cap.
#[tauri::command]
async fn set_history_retention(state: State<'_, AppState>, days: i64) -> Result<(), String> {
    state.mqtt.set_history_retention(days).await
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
async fn bench_start(
    app: AppHandle,
    state: State<'_, AppState>,
    spec: bench::BenchSpec,
) -> Result<(), String> {
    state.mqtt.clone().bench_start(app, spec).await
}

#[tauri::command]
async fn bench_progress(
    state: State<'_, AppState>,
) -> Result<Vec<bench::BenchProgress>, String> {
    Ok(state.mqtt.bench_progress())
}

#[tauri::command]
async fn bench_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.mqtt.bench_stop(&app, &id).await
}

#[tauri::command]
async fn bench_clear_finished(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.mqtt.bench_clear_finished())
}

#[tauri::command]
async fn publish_console(
    app: AppHandle,
    state: State<'_, AppState>,
    params: ConsolePublishParams,
) -> Result<(), String> {
    state.mqtt.publish_console(app, params).await
}

/// MQTT5 request/response: publish a request, watch its response topic, and
/// pair the answer by correlation data (`rpc.rs` owns the matching rules).
#[tauri::command]
async fn rpc_request(
    app: AppHandle,
    state: State<'_, AppState>,
    spec: rpc::RpcSpec,
) -> Result<rpc::RpcCall, String> {
    state.mqtt.clone().rpc_request(app, spec).await
}

#[tauri::command]
async fn rpc_list(state: State<'_, AppState>) -> Result<Vec<rpc::RpcCall>, String> {
    Ok(state.mqtt.rpc_list().await)
}

#[tauri::command]
async fn rpc_clear_finished(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.mqtt.rpc_clear_finished().await)
}

/// Start a backend-scheduled publish (see `scheduler.rs` for the state machine).
#[tauri::command]
async fn schedule_start(
    app: AppHandle,
    state: State<'_, AppState>,
    spec: scheduler::ScheduleSpec,
) -> Result<(), String> {
    state.mqtt.clone().schedule_start(app, spec).await
}

#[tauri::command]
async fn schedule_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.mqtt.schedule_stop(&app, &id).await
}

#[tauri::command]
async fn schedule_list(
    state: State<'_, AppState>,
) -> Result<Vec<scheduler::RunInfo>, String> {
    Ok(state.mqtt.schedule_list())
}

#[tauri::command]
async fn schedule_clear_finished(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.mqtt.schedule_clear_finished())
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

/// Replace the silence-watchdog rule set. Same lifecycle as bridge rules: the
/// frontend owns persistence and pushes the whole set on every change.
#[tauri::command]
async fn silence_sync_rules(
    state: State<'_, AppState>,
    rules: Vec<silence::SilenceRule>,
) -> Result<(), String> {
    state.mqtt.silence_watchdog
        .sync_rules(rules, chrono::Utc::now().timestamp())
}

/// Replace the message-assertion rule set and report what has been judged so far.
/// A set with one bad predicate is refused whole, so the tallies never belong to a
/// half-applied rule list.
#[tauri::command]
async fn assertions_sync_rules(
    state: State<'_, AppState>,
    rules: Vec<assertions::AssertionRule>,
) -> Result<assertions::AssertionSnapshot, String> {
    state.mqtt.assertions.sync_rules(rules)?;
    Ok(state.mqtt.assertions.snapshot())
}

/// Turn one typed line into a structured rule, or say why it cannot be one. The
/// grammar lives in Rust so a rule that would silently never fire cannot be saved.
#[tauri::command]
async fn assertions_parse_rule(
    id: String,
    filter: String,
    predicate: String,
    label: String,
) -> Result<assertions::AssertionRule, String> {
    let mut rule = assertions::parse_rule(&id, &filter, &predicate)?;
    rule.label = label;
    Ok(rule)
}

#[tauri::command]
async fn assertions_state(state: State<'_, AppState>) -> Result<assertions::AssertionSnapshot, String> {
    Ok(state.mqtt.assertions.snapshot())
}

/// Forget the tallies, keep the rules armed.
#[tauri::command]
async fn assertions_reset(state: State<'_, AppState>) -> Result<assertions::AssertionSnapshot, String> {
    state.mqtt.assertions.reset();
    Ok(state.mqtt.assertions.snapshot())
}

/// Replace the fault-injection rule set. Every rule reports what it has actually
/// done, because a fault nobody can count is indistinguishable from a network problem.
#[tauri::command]
async fn faults_sync_rules(
    state: State<'_, AppState>,
    rules: Vec<faults::FaultRule>,
) -> Result<Vec<faults::FaultRuleStats>, String> {
    state.mqtt.faults.sync_rules(rules)?;
    Ok(state.mqtt.faults.stats())
}

#[tauri::command]
async fn faults_stats(state: State<'_, AppState>) -> Result<Vec<faults::FaultRuleStats>, String> {
    Ok(state.mqtt.faults.stats())
}

#[tauri::command]
async fn faults_reset(state: State<'_, AppState>) -> Result<Vec<faults::FaultRuleStats>, String> {
    state.mqtt.faults.reset();
    Ok(state.mqtt.faults.stats())
}

/// Replace the scripted-responder rule set. A rule whose reply answers its own
/// trigger is a loop and is refused here, before it can generate traffic.
#[tauri::command]
async fn responder_sync_rules(
    state: State<'_, AppState>,
    rules: Vec<responder::ResponderRule>,
) -> Result<Vec<responder::ResponderStats>, String> {
    state.mqtt.responder.sync_rules(rules)?;
    Ok(state.mqtt.responder.stats())
}

#[tauri::command]
async fn responder_stats(state: State<'_, AppState>) -> Result<Vec<responder::ResponderStats>, String> {
    Ok(state.mqtt.responder.stats())
}

#[tauri::command]
async fn responder_reset(state: State<'_, AppState>) -> Result<Vec<responder::ResponderStats>, String> {
    state.mqtt.responder.reset();
    Ok(state.mqtt.responder.stats())
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
    // Even a dry run gets the blocking pool: a runaway script is killed only at
    // its deadline, and that time should not be borrowed from an async worker.
    let script = trimmed.to_string();
    match tokio::task::spawn_blocking(move || {
        transform::apply_transform(&script, &topic, &Bytes::from(raw), 1, false)
    })
    .await
    .map_err(|_| "transform worker panicked".to_string())?
    {
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
            get_diagnostics_snapshot,
            start_send_file,
            pause_transfer,
            resume_transfer,
            cancel_transfer,
            subscribe_topic,
            unsubscribe_topic,
            get_subscription_ack_state,
            get_broker_capabilities,
            get_subscription_stats,
            get_subscription_ids,
            reset_subscription_stats,
            get_topic_stats,
            reset_topic_stats,
            get_broker_sys,
            clear_broker_sys,
            query_history,
            history_series,
            history_stats,
            history_topics,
            set_history_retention,
            clear_history,
            set_topic_stats_cap,
            get_topic_stats_cap,
            bench_start,
            bench_progress,
            bench_stop,
            bench_clear_finished,
            publish_console,
            rpc_request,
            rpc_list,
            rpc_clear_finished,
            schedule_start,
            schedule_stop,
            schedule_list,
            schedule_clear_finished,
            approve_transfer,
            reject_transfer,
            set_auto_receive,
            reveal_file,
            bridge_connect,
            bridge_disconnect,
            bridge_status,
            bridge_sync_rules,
            silence_sync_rules,
            assertions_sync_rules,
            assertions_parse_rule,
            assertions_state,
            assertions_reset,
            faults_sync_rules,
            faults_stats,
            faults_reset,
            responder_sync_rules,
            responder_stats,
            responder_reset,
            bridge_stats,
            bridge_reset_stats,
            bridge_test_transform
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let (mqtt, bridge) = {
                    let state = window.state::<AppState>();
                    (state.mqtt.clone(), state.bridge.clone())
                };
                let win = window.clone();
                // Closing the window used to drop the process mid-session, so the
                // broker saw an abnormal disconnect instead of a DISCONNECT. Hold
                // the close briefly, tell both sides we are leaving, then destroy.
                api.prevent_close();
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_millis(1_200),
                        async {
                            mqtt.disconnect().await;
                            bridge.disconnect_all().await;
                        },
                    )
                    .await;
                    let _ = win.destroy();
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
