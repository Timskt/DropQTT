pub mod mqtt_manager;
pub mod protocol;
pub mod transport;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::mqtt_manager::MqttManager;
use crate::protocol::{BrokerConfig, ConnectionStatus, ConsolePublishParams};

pub struct AppState {
    pub mqtt: Arc<MqttManager>,
}

#[tauri::command]
async fn get_default_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    let dir = state.mqtt.get_download_dir().await;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn set_download_dir(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.mqtt.set_download_dir(PathBuf::from(path)).await;
    Ok(())
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

#[tauri::command]
async fn reveal_file(app: AppHandle, file_path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        let _ = app.opener().open_path(parent.to_string_lossy().as_ref(), None::<&str>);
    } else {
        let _ = app.opener().open_path(&file_path, None::<&str>);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mqtt_manager = Arc::new(MqttManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            mqtt: mqtt_manager,
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(debug_assertions)]
                window.open_devtools();
                #[cfg(not(debug_assertions))]
                let _ = window;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_default_download_dir,
            set_download_dir,
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
            publish_console,
            approve_transfer,
            reject_transfer,
            set_auto_receive,
            reveal_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
