//! Protocol-version agnostic transport layer.
//!
//! Normalizes rumqttc's v3.1.1 and v5.0 clients, event loops and packets into
//! a single dispatch surface so `mqtt_manager` stays version agnostic.

use std::time::Duration;

use bytes::Bytes;
use rumqttc::{MqttOptions, QoS, Transport as RumqttcTransport};

use crate::protocol::{BrokerConfig, PubProperties};

/// A normalized incoming publish, independent of protocol version.
#[derive(Debug, Clone)]
pub struct NormalizedPublish {
    pub topic: String,
    pub payload: Bytes,
    pub qos: u8,
    pub retain: bool,
    pub content_type: Option<String>,
    pub user_properties: Vec<(String, String)>,
}

/// Normalized eventloop notifications.
#[derive(Debug)]
pub enum NetEvent {
    /// CONNACK received (initial connect or automatic reconnect)
    Connected,
    /// Transport-level failure; rumqttc keeps retrying on the next poll
    ConnectionError(String),
    /// Incoming publish packet
    Publish(NormalizedPublish),
    /// Any other packet we intentionally ignore (SubAck, PubAck, ...)
    Other,
}

pub enum MqttClient {
    V3(rumqttc::AsyncClient),
    V5(rumqttc::v5::AsyncClient),
}

impl Clone for MqttClient {
    fn clone(&self) -> Self {
        match self {
            MqttClient::V3(c) => MqttClient::V3(c.clone()),
            MqttClient::V5(c) => MqttClient::V5(c.clone()),
        }
    }
}

pub enum MqttEventLoop {
    V3(Box<rumqttc::EventLoop>),
    V5(Box<rumqttc::v5::EventLoop>),
}

fn qos_from_u8(v: u8) -> QoS {
    match v {
        0 => QoS::AtMostOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtLeastOnce,
    }
}

fn qos_to_u8(q: QoS) -> u8 {
    match q {
        QoS::AtMostOnce => 0,
        QoS::AtLeastOnce => 1,
        QoS::ExactlyOnce => 2,
    }
}

/// v5 uses its own QoS enum (`rumqttc::v5::mqttbytes::QoS`)
fn qos_from_u8_v5(v: u8) -> rumqttc::v5::mqttbytes::QoS {
    match v {
        0 => rumqttc::v5::mqttbytes::QoS::AtMostOnce,
        2 => rumqttc::v5::mqttbytes::QoS::ExactlyOnce,
        _ => rumqttc::v5::mqttbytes::QoS::AtLeastOnce,
    }
}

fn qos_to_u8_v5(q: rumqttc::v5::mqttbytes::QoS) -> u8 {
    match q {
        rumqttc::v5::mqttbytes::QoS::AtMostOnce => 0,
        rumqttc::v5::mqttbytes::QoS::AtLeastOnce => 1,
        rumqttc::v5::mqttbytes::QoS::ExactlyOnce => 2,
    }
}

/// Build a fresh client + eventloop pair for the given broker config.
pub fn build_connection(config: &BrokerConfig) -> (MqttClient, MqttEventLoop) {
    if config.is_v5() {
        let mut opts = rumqttc::v5::MqttOptions::new(&config.client_id, &config.host, config.port);
        opts.set_keep_alive(Duration::from_secs(config.keep_alive_secs.max(5)));
        opts.set_clean_start(config.clean_session);
        opts.set_max_packet_size(Some(10 * 1024 * 1024));

        if let (Some(u), Some(p)) = (&config.username, &config.password) {
            if !u.is_empty() {
                opts.set_credentials(u, p);
            }
        }
        if config.use_tls {
            opts.set_transport(RumqttcTransport::tls_with_default_config());
        }

        let (client, eventloop) = rumqttc::v5::AsyncClient::new(opts, 100);
        (MqttClient::V5(client), MqttEventLoop::V5(Box::new(eventloop)))
    } else {
        let mut opts = MqttOptions::new(&config.client_id, &config.host, config.port);
        opts.set_keep_alive(Duration::from_secs(config.keep_alive_secs.max(5)));
        opts.set_clean_session(config.clean_session);
        opts.set_max_packet_size(10 * 1024 * 1024, 10 * 1024 * 1024);

        if let (Some(u), Some(p)) = (&config.username, &config.password) {
            if !u.is_empty() {
                opts.set_credentials(u, p);
            }
        }
        if config.use_tls {
            opts.set_transport(RumqttcTransport::tls_with_default_config());
        }

        let (client, eventloop) = rumqttc::AsyncClient::new(opts, 100);
        (MqttClient::V3(client), MqttEventLoop::V3(Box::new(eventloop)))
    }
}

impl MqttClient {
    pub async fn publish(
        &self,
        topic: &str,
        qos: u8,
        retain: bool,
        payload: Bytes,
        props: Option<&PubProperties>,
    ) -> Result<(), String> {
        match self {
            MqttClient::V3(client) => client
                .publish(topic, qos_from_u8(qos), retain, payload)
                .await
                .map_err(|e| format!("{:?}", e)),
            MqttClient::V5(client) => {
                let v5_props = props.map(|p| rumqttc::v5::mqttbytes::v5::PublishProperties {
                    content_type: p.content_type.clone(),
                    user_properties: p.user_properties.clone(),
                    message_expiry_interval: p.message_expiry,
                    ..Default::default()
                });
                match v5_props {
                    Some(vp) => client
                        .publish_with_properties(
                            topic,
                            qos_from_u8_v5(qos),
                            retain,
                            payload,
                            vp,
                        )
                        .await
                        .map_err(|e| format!("{:?}", e)),
                    None => client
                        .publish(topic, qos_from_u8_v5(qos), retain, payload)
                        .await
                        .map_err(|e| format!("{:?}", e)),
                }
            }
        }
    }

    pub async fn subscribe(&self, topic: &str, qos: u8) -> Result<(), String> {
        match self {
            MqttClient::V3(client) => {
                client.subscribe(topic, qos_from_u8(qos)).await.map_err(|e| format!("{:?}", e))
            }
            MqttClient::V5(client) => {
                client
                    .subscribe(topic, qos_from_u8_v5(qos))
                    .await
                    .map_err(|e| format!("{:?}", e))
            }
        }
    }

    pub async fn unsubscribe(&self, topic: &str) {
        match self {
            MqttClient::V3(client) => {
                let _ = client.unsubscribe(topic).await;
            }
            MqttClient::V5(client) => {
                let _ = client.unsubscribe(topic).await;
            }
        }
    }

    pub async fn disconnect(&self) {
        match self {
            MqttClient::V3(client) => {
                let _ = client.disconnect().await;
            }
            MqttClient::V5(client) => {
                let _ = client.disconnect().await;
            }
        }
    }
}

impl MqttEventLoop {
    /// Poll the next normalized event. Never returns — callers must supply
    /// their own shutdown handling around this future.
    pub async fn poll(&mut self) -> NetEvent {
        match self {
            MqttEventLoop::V3(loop3) => match loop3.poll().await {
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(_))) => NetEvent::Connected,
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::Publish(p))) => {
                    NetEvent::Publish(NormalizedPublish {
                        topic: p.topic,
                        payload: p.payload,
                        qos: qos_to_u8(p.qos),
                        retain: p.retain,
                        content_type: None,
                        user_properties: Vec::new(),
                    })
                }
                Ok(_) => NetEvent::Other,
                Err(e) => NetEvent::ConnectionError(format!("{:?}", e)),
            },
            MqttEventLoop::V5(loop5) => match loop5.poll().await {
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::ConnAck(_))) => {
                    NetEvent::Connected
                }
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::Publish(p))) => {
                    let (content_type, user_properties) = match p.properties {
                        Some(vp) => (vp.content_type, vp.user_properties),
                        None => (None, Vec::new()),
                    };
                    NetEvent::Publish(NormalizedPublish {
                        topic: String::from_utf8_lossy(&p.topic).to_string(),
                        payload: p.payload,
                        qos: qos_to_u8_v5(p.qos),
                        retain: p.retain,
                        content_type,
                        user_properties,
                    })
                }
                Ok(_) => NetEvent::Other,
                Err(e) => NetEvent::ConnectionError(format!("{:?}", e)),
            },
        }
    }
}
