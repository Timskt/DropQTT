//! Protocol-version agnostic transport layer.
//!
//! Normalizes rumqttc's v3.1.1 and v5.0 clients, event loops and packets into
//! a single dispatch surface so `mqtt_manager` stays version agnostic.

use std::time::Duration;

use bytes::Bytes;
use rumqttc::v5::mqttbytes::v5::{Filter, RetainForwardRule};
use rumqttc::{MqttOptions, QoS, Transport as RumqttcTransport};

use crate::protocol::{BrokerConfig, PubProperties, SubOptions};

/// Resolve the transport for a config across the four combinations:
/// plain TCP, TLS (mTLS-capable), WebSocket, and WSS (TLS over WebSocket).
/// Returns `None` for a plain TCP connection.
///
/// Explicitly configured TLS material never degrades silently: falling back to
/// system roots would let a user believe a private-CA or mTLS pin is enforced
/// while the broker is in fact validated against the public trust store (or
/// client auth is simply absent).
/// Keep-alive band the app accepts. The UI clamps to the same numbers, and this
/// side is authoritative: a hand-edited profile must not be able to ask for a
/// zero-second or a hundred-thousand-second keep-alive and quietly break the
/// session (or flood the broker with PINGREQs).
pub const MIN_KEEP_ALIVE_SECS: u64 = 5;
pub const MAX_KEEP_ALIVE_SECS: u64 = 600;

pub fn clamp_keep_alive(requested: u64) -> u64 {
    requested.clamp(MIN_KEEP_ALIVE_SECS, MAX_KEEP_ALIVE_SECS)
}

fn read_tls_file(path: &str, kind: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{} '{}' is unreadable: {}", kind, path, e))
}

fn build_transport(config: &BrokerConfig) -> Result<Option<RumqttcTransport>, String> {
    if !config.use_tls && !config.use_websocket {
        return Ok(None);
    }

    // Optional custom CA + client cert/key (mutual TLS) material.
    let ca_bytes = config
        .tls_ca_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|p| read_tls_file(p, "TLS CA file"))
        .transpose()?;
    let client_auth = match (
        config.tls_client_cert_path.as_deref().map(str::trim),
        config.tls_client_key_path.as_deref().map(str::trim),
    ) {
        (Some(cert), Some(key)) if !cert.is_empty() && !key.is_empty() => Some((
            read_tls_file(cert, "mTLS client certificate")?,
            read_tls_file(key, "mTLS client key")?,
        )),
        // One half configured is a misconfiguration, not an opt-out.
        (Some(cert), _) if !cert.is_empty() => {
            return Err("mTLS client certificate set without a private key".into());
        }
        (_, Some(key)) if !key.is_empty() => {
            return Err("mTLS private key set without a client certificate".into());
        }
        _ => None,
    };

    if config.use_websocket {
        // Plain WebSocket needs no TLS material.
        if !config.use_tls {
            return Ok(Some(RumqttcTransport::Ws));
        }
        return Ok(Some(match ca_bytes {
            Some(ca) => RumqttcTransport::wss(ca, client_auth, None),
            None => RumqttcTransport::wss_with_default_config(),
        }));
    }

    // TCP + TLS
    Ok(Some(match ca_bytes {
        Some(ca) => RumqttcTransport::tls(ca, client_auth, None),
        None => RumqttcTransport::tls_with_default_config(),
    }))
}

/// Whether a non-empty will topic is configured (WILL FLAG should be set).
fn will_active(topic: &Option<String>) -> bool {
    topic.as_deref().map(str::trim).is_some_and(|t| !t.is_empty())
}

/// A normalized incoming publish, independent of protocol version.
#[derive(Debug, Clone)]
pub struct NormalizedPublish {
    pub topic: String,
    pub payload: Bytes,
    pub qos: u8,
    pub retain: bool,
    pub content_type: Option<String>,
    pub user_properties: Vec<(String, String)>,
    pub response_topic: Option<String>,
    /// MQTT5 Correlation Data, kept as the bytes the broker sent. The spec makes
    /// it an opaque byte string, and devices commonly use a 4-byte UUID or a
    /// protobuf tag; decoding it as UTF-8 would make request/response pairing
    /// depend on the payload happening to be text.
    pub correlation_data: Option<Vec<u8>>,
    /// MQTT5 Payload Format Indicator as the publisher declared it
    pub payload_format: Option<u8>,
}

/// Which acknowledgement a broker refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AckStage {
    Subscribe,
    Unsubscribe,
    PublishAck,
    PublishReceive,
    PublishRelease,
    PublishComplete,
    /// The broker sent a DISCONNECT packet with an error reason.
    ServerDisconnect,
    /// The CONNACK itself was refused.
    Connect,
}

/// Normalized eventloop notifications.
#[derive(Debug)]
pub enum NetEvent {
    /// CONNACK received (initial connect or automatic reconnect). Carries the
    /// broker's `topic-alias-maximum`, which bounds the aliases we may send.
    Connected(u16),
    /// Transport-level failure; rumqttc keeps retrying on the next poll
    ConnectionError(String),
    /// Incoming publish packet
    Publish(NormalizedPublish),
    /// PUBACK (QoS1), PUBREC (QoS2 first half) or PUBCOMP (QoS2 final half) for
    /// one of our publishes. `code` is the v5 reason byte; `None` means v3.1.1,
    /// which has no reason codes and acknowledges only by the packet's presence.
    PublishAcked {
        /// v5 reason byte. 0x00 is the only delivery acknowledgement; 0x10 means
        /// the broker took the packet but nobody was subscribed; 0x80 and above
        /// are refusals. v3.1.1 has no reason codes and always reports 0x00,
        /// because there the packet's presence *is* the acknowledgement.
        code: u8,
        reason_string: Option<String>,
    },
    /// SUBACK: one reason byte per filter, in the order we sent them.
    SubAck {
        codes: Vec<u8>,
        reason_string: Option<String>,
    },
    /// UNSUBACK: same shape, and a refusal means the broker may still be
    /// delivering on a filter we just dropped locally.
    UnsubAck {
        codes: Vec<u8>,
        reason_string: Option<String>,
    },
    /// A broker **refusal** of an ack. This is not a packet we got to see:
    /// rumqttc's v5 state machine turns any non-success ack code into a fatal
    /// `StateError` (`SubFail`, `PubAckFail`, ...), which tears the connection
    /// down *instead of* delivering the SUBACK. Recognizing it is the only way
    /// to tell the user why the session keeps dropping — and the only way to
    /// stop replaying the filter that caused it.
    AckRejected {
        stage: AckStage,
        code: u8,
        /// `Debug` form of rumqttc's variant, for the diagnostics report only;
        /// the UI speaks from `code`.
        text: String,
    },
    /// Any other packet we intentionally ignore (AUTH, PINGRESP, ...)
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

/// Wire byte for a v3.1.1 SUBACK code. Kept in sync with the spec by the tests
/// at the bottom of this module.
fn sub_code_v3(code: &rumqttc::mqttbytes::v4::SubscribeReasonCode) -> u8 {
    use rumqttc::mqttbytes::v4::SubscribeReasonCode as C;
    match code {
        C::Success(q) => qos_to_u8(*q),
        C::Failure => 0x80,
    }
}

/// Wire byte for a v5 SUBACK code (MQTT 5 §3.2.2.2.0).
fn sub_code_v5(code: &rumqttc::v5::mqttbytes::v5::SubscribeReasonCode) -> u8 {
    use rumqttc::v5::mqttbytes::v5::SubscribeReasonCode as C;
    match code {
        C::Success(q) => qos_to_u8_v5(*q),
        C::Failure | C::Unspecified => 0x80,
        C::ImplementationSpecific => 0x83,
        C::NotAuthorized => 0x87,
        C::TopicFilterInvalid => 0x8F,
        C::PkidInUse => 0x91,
        C::QuotaExceeded => 0x97,
        C::SharedSubscriptionsNotSupported => 0x9E,
        C::SubscriptionIdNotSupported => 0xA1,
        C::WildcardSubscriptionsNotSupported => 0xA2,
    }
}

fn unsub_code_v5(code: &rumqttc::v5::mqttbytes::v5::UnsubAckReason) -> u8 {
    use rumqttc::v5::mqttbytes::v5::UnsubAckReason as C;
    match code {
        C::Success => 0x00,
        C::NoSubscriptionExisted => 0x11,
        C::UnspecifiedError => 0x80,
        C::ImplementationSpecificError => 0x83,
        C::NotAuthorized => 0x87,
        C::TopicFilterInvalid => 0x8F,
        C::PacketIdentifierInUse => 0x91,
    }
}

fn puback_code_v5(code: &rumqttc::v5::mqttbytes::v5::PubAckReason) -> u8 {
    use rumqttc::v5::mqttbytes::v5::PubAckReason as C;
    match code {
        C::Success => 0x00,
        C::NoMatchingSubscribers => 0x10,
        C::UnspecifiedError => 0x80,
        C::ImplementationSpecificError => 0x83,
        C::NotAuthorized => 0x87,
        C::TopicNameInvalid => 0x90,
        C::PacketIdentifierInUse => 0x91,
        C::QuotaExceeded => 0x97,
        C::PayloadFormatInvalid => 0x99,
    }
}

fn pubrec_code_v5(code: &rumqttc::v5::mqttbytes::v5::PubRecReason) -> u8 {
    use rumqttc::v5::mqttbytes::v5::PubRecReason as C;
    match code {
        C::Success => 0x00,
        C::NoMatchingSubscribers => 0x10,
        C::UnspecifiedError => 0x80,
        C::ImplementationSpecificError => 0x83,
        C::NotAuthorized => 0x87,
        C::TopicNameInvalid => 0x90,
        C::PacketIdentifierInUse => 0x91,
        C::QuotaExceeded => 0x97,
        C::PayloadFormatInvalid => 0x99,
    }
}

fn pubcomp_code_v5(code: &rumqttc::v5::mqttbytes::v5::PubCompReason) -> u8 {
    use rumqttc::v5::mqttbytes::v5::PubCompReason as C;
    match code {
        C::Success => 0x00,
        C::PacketIdentifierNotFound => 0x92,
    }
}

/// `mqttbytes` gives every ack packet its own properties struct with no shared
/// trait, so the optional reason string is pulled out through this one seam.
/// Capped because the value is broker-controlled and ends up in UI events.
pub trait AckProperties {
    fn reason_string(&self) -> Option<String>;
}

macro_rules! impl_ack_properties {
    ($($ty:ty),+ $(,)?) => {
        $(
            impl AckProperties for $ty {
                fn reason_string(&self) -> Option<String> {
                    self.reason_string.as_ref().map(|s| {
                        let cut = s.chars().take(200).collect::<String>();
                        cut
                    })
                }
            }
        )+
    };
}

impl_ack_properties!(
    rumqttc::v5::mqttbytes::v5::SubAckProperties,
    rumqttc::v5::mqttbytes::v5::UnsubAckProperties,
    rumqttc::v5::mqttbytes::v5::PubAckProperties,
    rumqttc::v5::mqttbytes::v5::PubRecProperties,
    rumqttc::v5::mqttbytes::v5::PubCompProperties,
);

fn ack_reason_string<P: AckProperties>(props: Option<&P>) -> Option<String> {
    props.and_then(|p| p.reason_string()).filter(|s| !s.trim().is_empty())
}

/// UI publish properties → the wire struct. Empty strings are dropped rather
/// than sent, because a zero-length property is a different statement from an
/// absent one.
fn v5_publish_properties(p: &PubProperties) -> rumqttc::v5::mqttbytes::v5::PublishProperties {
    rumqttc::v5::mqttbytes::v5::PublishProperties {
        // 0 (ByteStream) and 1 (UTF-8) are the only defined values; anything else
        // would be a protocol error, so it stays off the wire.
        payload_format_indicator: p.payload_format.filter(|v| *v <= 1),
        // Alias 0 is not assignable, and an unset alias must not register every
        // topic under 0.
        topic_alias: p.topic_alias.filter(|a| *a > 0),
        content_type: p.content_type.clone(),
        user_properties: p.user_properties.clone(),
        message_expiry_interval: p.message_expiry,
        response_topic: p
            .response_topic
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        correlation_data: correlation_bytes(p),
        ..Default::default()
    }
}

/// Correlation bytes for the wire. The hex form wins when it is present, because
/// it is how a non-UTF-8 correlation survives a bridge hop; otherwise the text
/// field is sent as its own UTF-8 bytes.
fn correlation_bytes(p: &PubProperties) -> Option<Bytes> {
    if let Some(raw) = p.correlation_hex.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(bytes) = hex::decode(raw) {
            if !bytes.is_empty() {
                return Some(Bytes::from(bytes));
            }
        }
    }
    p.correlation_data
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| Bytes::copy_from_slice(s.as_bytes()))
}

/// Reject a topic alias the broker would refuse. Sending one anyway is a
/// protocol violation that rumqttc reports by tearing the connection down, so a
/// silent publish failure would look like the app dropping the link.
pub fn alias_rejection(alias: Option<u16>, broker_max: u16) -> Option<String> {
    let alias = alias.filter(|a| *a > 0)?;
    if broker_max == 0 {
        return Some(format!(
            "broker announced no topic-alias support; cannot send alias {alias} (clear it to publish)"
        ));
    }
    (alias > broker_max).then(|| {
        format!("broker allows topic aliases up to {broker_max}, not {alias} (clear it to publish)")
    })
}

/// v5 will properties from the connection config. `None` keeps the will packet
/// property-free, which is what a v3.1.1-style will looks like on the wire.
fn will_properties(
    config: &BrokerConfig,
) -> Option<rumqttc::v5::mqttbytes::v5::LastWillProperties> {
    let delay = config.will_delay_secs.filter(|d| *d > 0);
    let content_type = config
        .will_content_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    if delay.is_none() && content_type.is_none() {
        return None;
    }
    Some(rumqttc::v5::mqttbytes::v5::LastWillProperties {
        delay_interval: delay,
        payload_format_indicator: None,
        message_expiry_interval: None,
        content_type,
        response_topic: None,
        correlation_data: None,
        user_properties: Vec::new(),
    })
}

/// Build a fresh client + eventloop pair for the given broker config.
pub fn build_connection(config: &BrokerConfig) -> Result<(MqttClient, MqttEventLoop), String> {
    let transport = build_transport(config)?;
    if config.is_v5() {
        let mut opts = rumqttc::v5::MqttOptions::new(&config.client_id, &config.host, config.port);
        opts.set_keep_alive(Duration::from_secs(clamp_keep_alive(config.keep_alive_secs)));
        opts.set_clean_start(config.clean_session);
        opts.set_max_packet_size(Some(10 * 1024 * 1024));

        if let (Some(u), Some(p)) = (&config.username, &config.password) {
            if !u.is_empty() {
                opts.set_credentials(u, p);
            }
        }
        if will_active(&config.will_topic) {
            opts.set_last_will(rumqttc::v5::mqttbytes::v5::LastWill::new(
                config.will_topic.clone().unwrap_or_default(),
                config.will_payload.clone().unwrap_or_default(),
                qos_from_u8_v5(config.will_qos),
                config.will_retain,
                will_properties(config),
            ));
        }
        if let Some(transport) = transport {
            opts.set_transport(transport);
        }
        // Session-Expiry-Interval rides on CONNECT properties and rumqttc has no
        // dedicated setter for it. Read-modify-write, because `set_max_packet_size`
        // above already populated this same struct.
        if let Some(secs) = config.session_expiry_secs {
            let mut props = opts
                .connect_properties()
                .unwrap_or_default();
            props.session_expiry_interval = Some(secs);
            opts.set_connect_properties(props);
        }

        let (client, eventloop) = rumqttc::v5::AsyncClient::new(opts, 100);
        Ok((MqttClient::V5(client), MqttEventLoop::V5(Box::new(eventloop))))
    } else {
        let mut opts = MqttOptions::new(&config.client_id, &config.host, config.port);
        opts.set_keep_alive(Duration::from_secs(clamp_keep_alive(config.keep_alive_secs)));
        opts.set_clean_session(config.clean_session);
        opts.set_max_packet_size(10 * 1024 * 1024, 10 * 1024 * 1024);

        if let (Some(u), Some(p)) = (&config.username, &config.password) {
            if !u.is_empty() {
                opts.set_credentials(u, p);
            }
        }
        if will_active(&config.will_topic) {
            opts.set_last_will(rumqttc::LastWill::new(
                config.will_topic.clone().unwrap_or_default(),
                config.will_payload.clone().unwrap_or_default(),
                qos_from_u8(config.will_qos),
                config.will_retain,
            ));
        }
        if let Some(transport) = transport {
            opts.set_transport(transport);
        }

        let (client, eventloop) = rumqttc::AsyncClient::new(opts, 100);
        Ok((MqttClient::V3(client), MqttEventLoop::V3(Box::new(eventloop))))
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
                let v5_props = props.map(v5_publish_properties);
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

    /// Subscribe with v5 options. On a v3.1.1 connection only QoS is meaningful;
    /// the extra flags are silently inapplicable rather than rejected, because
    /// the same subscription registry is replayed after a protocol downgrade.
    pub async fn subscribe(&self, topic: &str, opts: &SubOptions) -> Result<(), String> {
        match self {
            MqttClient::V3(client) => client
                .subscribe(topic, qos_from_u8(opts.qos))
                .await
                .map_err(|e| format!("{:?}", e)),
            MqttClient::V5(client) => {
                if !opts.no_local && !opts.retain_as_published && opts.retain_handling == 0 {
                    return client
                        .subscribe(topic, qos_from_u8_v5(opts.qos))
                        .await
                        .map_err(|e| format!("{:?}", e));
                }
                let filter = Filter {
                    path: topic.to_string(),
                    qos: qos_from_u8_v5(opts.qos),
                    nolocal: opts.no_local,
                    preserve_retain: opts.retain_as_published,
                    retain_forward_rule: match opts.retain_handling {
                        1 => RetainForwardRule::OnNewSubscribe,
                        2 => RetainForwardRule::Never,
                        _ => RetainForwardRule::OnEverySubscribe,
                    },
                };
                client.subscribe_many([filter]).await.map_err(|e| format!("{:?}", e))
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
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(_))) => NetEvent::Connected(0),
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::Publish(p))) => {
                    NetEvent::Publish(NormalizedPublish {
                        topic: p.topic,
                        payload: p.payload,
                        qos: qos_to_u8(p.qos),
                        retain: p.retain,
                        content_type: None,
                        user_properties: Vec::new(),
                        response_topic: None,
                        correlation_data: None,
                        payload_format: None,
                    })
                }
                Ok(rumqttc::Event::Incoming(
                    rumqttc::Packet::PubAck(_) | rumqttc::Packet::PubComp(_),
                )) => NetEvent::PublishAcked {
                    code: 0x00,
                    reason_string: None,
                },
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::SubAck(s))) => NetEvent::SubAck {
                    codes: s.return_codes.iter().map(sub_code_v3).collect(),
                    reason_string: None,
                },
                Ok(rumqttc::Event::Incoming(rumqttc::Packet::UnsubAck(_))) => NetEvent::UnsubAck {
                    // One synthetic success byte per UNSUBSCRIBE sent: v3 carries
                    // no reason payload, but the pending slot still has to be
                    // drained or the attribution FIFO would drift.
                    codes: vec![0x00],
                    reason_string: None,
                },
                Ok(_) => NetEvent::Other,
                Err(e) => NetEvent::ConnectionError(format!("{:?}", e)),
            },
            MqttEventLoop::V5(loop5) => match loop5.poll().await {
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::ConnAck(a))) => {
                    NetEvent::Connected(
                        a.properties
                            .as_ref()
                            .and_then(|p| p.topic_alias_max)
                            .unwrap_or(0),
                    )
                }
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::Publish(p))) => {
                    let (content_type, user_properties, response_topic, correlation_data, payload_format) =
                        match p.properties {
                            Some(vp) => (
                                vp.content_type,
                                vp.user_properties,
                                vp.response_topic,
                                vp.correlation_data.map(|b| b.to_vec()),
                                vp.payload_format_indicator,
                            ),
                            None => (None, Vec::new(), None, None, None),
                        };
                    NetEvent::Publish(NormalizedPublish {
                        topic: String::from_utf8_lossy(&p.topic).to_string(),
                        payload: p.payload,
                        qos: qos_to_u8_v5(p.qos),
                        retain: p.retain,
                        content_type,
                        user_properties,
                        response_topic,
                        correlation_data,
                        payload_format,
                    })
                }
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::PubAck(a))) => {
                    NetEvent::PublishAcked {
                        code: puback_code_v5(&a.reason),
                        reason_string: ack_reason_string(a.properties.as_ref()),
                    }
                }
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::PubComp(c))) => {
                    NetEvent::PublishAcked {
                        code: pubcomp_code_v5(&c.reason),
                        reason_string: ack_reason_string(c.properties.as_ref()),
                    }
                }
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::PubRec(r))) => {
                    // A granted PUBREC is only the first half of the QoS2
                    // handshake; PUBCOMP is the terminal ack, so this must not
                    // count as one. A refused PUBREC has no later packet at all,
                    // so it is reported now rather than going missing.
                    let code = pubrec_code_v5(&r.reason);
                    if code == 0x00 {
                        NetEvent::Other
                    } else {
                        NetEvent::PublishAcked {
                            code,
                            reason_string: ack_reason_string(r.properties.as_ref()),
                        }
                    }
                }
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::SubAck(s))) => {
                    NetEvent::SubAck {
                        codes: s.return_codes.iter().map(sub_code_v5).collect(),
                        reason_string: ack_reason_string(s.properties.as_ref()),
                    }
                }
                Ok(rumqttc::v5::Event::Incoming(rumqttc::v5::mqttbytes::v5::Packet::UnsubAck(u))) => {
                    NetEvent::UnsubAck {
                        codes: u.reasons.iter().map(unsub_code_v5).collect(),
                        reason_string: ack_reason_string(u.properties.as_ref()),
                    }
                }
                Ok(_) => NetEvent::Other,
                Err(e) => v5_error_event(&e),
            },
        }
    }
}

/// Split rumqttc's one error channel into what actually happened.
///
/// Every ack refusal arrives here rather than as a packet: `MqttState` treats a
/// non-success reason code as fatal, closes the connection, and the eventloop
/// reconnects. Without this split the app sees an opaque `MqttState(SubFail ..)`
/// string and a session that flaps forever, because the offending filter is
/// replayed on every CONNACK.
fn v5_error_event(e: &rumqttc::v5::ConnectionError) -> NetEvent {
    use rumqttc::v5::mqttbytes::v5::{PubCompReason, PubRecReason, PubRelReason, UnsubAckReason};
    use rumqttc::v5::StateError as S;
    use rumqttc::v5::ConnectionError as C;

    if let C::MqttState(state) = e {
        match state {
            S::SubFail { reason } => {
                return NetEvent::AckRejected {
                    stage: AckStage::Subscribe,
                    code: sub_code_v5(reason),
                    text: format!("{reason:?}"),
                }
            }
            S::UnsubFail { reason } => {
                return NetEvent::AckRejected {
                    stage: AckStage::Unsubscribe,
                    code: match reason {
                        UnsubAckReason::Success => 0x00,
                        UnsubAckReason::NoSubscriptionExisted => 0x11,
                        UnsubAckReason::UnspecifiedError => 0x80,
                        UnsubAckReason::ImplementationSpecificError => 0x83,
                        UnsubAckReason::NotAuthorized => 0x87,
                        UnsubAckReason::TopicFilterInvalid => 0x8F,
                        UnsubAckReason::PacketIdentifierInUse => 0x91,
                    },
                    text: format!("{reason:?}"),
                }
            }
            S::PubAckFail { reason } => {
                return NetEvent::AckRejected {
                    stage: AckStage::PublishAck,
                    code: puback_code_v5(reason),
                    text: format!("{reason:?}"),
                }
            }
            S::PubRecFail { reason } => {
                return NetEvent::AckRejected {
                    stage: AckStage::PublishReceive,
                    code: match reason {
                        PubRecReason::Success => 0x00,
                        PubRecReason::NoMatchingSubscribers => 0x10,
                        PubRecReason::UnspecifiedError => 0x80,
                        PubRecReason::ImplementationSpecificError => 0x83,
                        PubRecReason::NotAuthorized => 0x87,
                        PubRecReason::TopicNameInvalid => 0x90,
                        PubRecReason::PacketIdentifierInUse => 0x91,
                        PubRecReason::QuotaExceeded => 0x97,
                        PubRecReason::PayloadFormatInvalid => 0x99,
                    },
                    text: format!("{reason:?}"),
                }
            }
            S::PubRelFail { reason } => {
                return NetEvent::AckRejected {
                    stage: AckStage::PublishRelease,
                    code: match reason {
                        PubRelReason::Success => 0x00,
                        PubRelReason::PacketIdentifierNotFound => 0x92,
                    },
                    text: format!("{reason:?}"),
                }
            }
            S::PubCompFail { reason } => {
                return NetEvent::AckRejected {
                    stage: AckStage::PublishComplete,
                    code: match reason {
                        PubCompReason::Success => 0x00,
                        PubCompReason::PacketIdentifierNotFound => 0x92,
                    },
                    text: format!("{reason:?}"),
                }
            }
            S::ServerDisconnect {
                reason_code,
                reason_string,
            } => {
                return NetEvent::AckRejected {
                    stage: AckStage::ServerDisconnect,
                    code: *reason_code as u8,
                    text: reason_string.clone().unwrap_or_else(|| format!("{reason_code:?}")),
                }
            }
            _ => {}
        }
    }
    NetEvent::ConnectionError(format!("{:?}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> BrokerConfig {
        BrokerConfig {
            host: "127.0.0.1".into(),
            port: 8883,
            ..Default::default()
        }
    }

    /// `MqttClient`/`MqttEventLoop` are not `Debug`, so `expect_err` is unusable.
    fn connect_err(c: &BrokerConfig) -> String {
        match build_connection(c) {
            Ok(_) => panic!("expected the connection build to fail"),
            Err(e) => e,
        }
    }

    #[test]
    fn topic_aliases_are_gated_by_what_the_broker_announced() {
        // A CONNACK without the property means "no aliases at all", and sending
        // one anyway kills the connection at the protocol layer.
        assert_eq!(alias_rejection(None, 0), None);
        assert_eq!(alias_rejection(Some(0), 0), None, "alias 0 is not sent");
        assert!(alias_rejection(Some(3), 0).unwrap().contains("no topic-alias support"));
        assert!(alias_rejection(Some(3), 2).unwrap().contains("up to 2"));
        assert_eq!(alias_rejection(Some(2), 2), None, "the limit is inclusive");
        assert_eq!(alias_rejection(Some(10), 65535), None);
    }

    #[test]
    fn publish_properties_only_carry_what_the_ui_set() {
        let empty = v5_publish_properties(&PubProperties::default());
        assert_eq!(empty.payload_format_indicator, None);
        assert_eq!(empty.topic_alias, None);
        assert_eq!(empty.content_type, None);
        assert_eq!(empty.correlation_data, None);

        // ByteStream is a real statement (0), not "absent".
        let bytes = v5_publish_properties(&PubProperties {
            payload_format: Some(0),
            topic_alias: Some(3),
            response_topic: Some("   ".into()),
            correlation_data: Some(String::new()),
            message_expiry: Some(60),
            ..Default::default()
        });
        assert_eq!(bytes.payload_format_indicator, Some(0));
        assert_eq!(bytes.topic_alias, Some(3), "alias 3 is assignable");
        assert_eq!(bytes.response_topic, None, "blank is not a topic");
        assert_eq!(bytes.correlation_data, None);
        assert_eq!(bytes.message_expiry_interval, Some(60));

        // Out-of-range values stay off the wire instead of corrupting the packet.
        assert_eq!(
            v5_publish_properties(&PubProperties {
                payload_format: Some(7),
                topic_alias: Some(0),
                ..Default::default()
            })
            .payload_format_indicator,
            None
        );
        assert_eq!(
            v5_publish_properties(&PubProperties {
                payload_format: Some(7),
                topic_alias: Some(0),
                ..Default::default()
            })
            .topic_alias,
            None
        );
    }

    #[test]
    fn correlation_bytes_prefer_the_lossless_hex_form() {
        // The bridge uses hex to forward a correlation that is not text.
        let p = PubProperties {
            correlation_data: Some("stale".into()),
            correlation_hex: Some("04d481f7".into()),
            ..Default::default()
        };
        assert_eq!(
            v5_publish_properties(&p).correlation_data,
            Some(Bytes::from_static(&[0x04, 0xd4, 0x81, 0xf7]))
        );

        // No hex: the text goes out as its own UTF-8 bytes.
        let p = PubProperties {
            correlation_data: Some("req-7".into()),
            ..Default::default()
        };
        assert_eq!(
            v5_publish_properties(&p).correlation_data,
            Some(Bytes::from_static(b"req-7"))
        );

        // Unparseable or empty hex is not a licence to send garbage; the text
        // field still speaks.
        let p = PubProperties {
            correlation_data: Some("req-7".into()),
            correlation_hex: Some("zz".into()),
            ..Default::default()
        };
        assert_eq!(
            v5_publish_properties(&p).correlation_data,
            Some(Bytes::from_static(b"req-7"))
        );
        let p = PubProperties {
            correlation_hex: Some("  ".into()),
            ..Default::default()
        };
        assert_eq!(v5_publish_properties(&p).correlation_data, None);
    }

    #[test]
    fn will_properties_are_omitted_until_the_v5_fields_are_used() {
        let mut c = cfg();
        c.will_topic = Some("device/offline".into());
        c.will_payload = Some("bye".into());
        assert!(will_properties(&c).is_none(), "a plain v3-style will stays bare");

        c.will_delay_secs = Some(0);
        assert!(will_properties(&c).is_none(), "delay 0 is the protocol default");

        c.will_delay_secs = Some(30);
        let w = will_properties(&c).expect("delay produces properties");
        assert_eq!(w.delay_interval, Some(30));
        assert_eq!(w.content_type, None);

        c.will_content_type = Some("  ".into());
        assert_eq!(
            will_properties(&c).expect("still has the delay").content_type,
            None,
            "blank content type is not a media type"
        );
        c.will_content_type = Some("application/json".into());
        assert_eq!(
            will_properties(&c).expect("both set").content_type.as_deref(),
            Some("application/json")
        );
    }

    #[test]
    fn plain_tcp_and_default_tls_stay_valid() {
        // No TLS at all, and TLS trusting the system store, are both intentional.
        assert!(build_transport(&cfg()).unwrap().is_none());
        let mut tls = cfg();
        tls.use_tls = true;
        assert!(build_transport(&tls).is_ok());
        let mut ws = cfg();
        ws.use_websocket = true;
        assert!(matches!(
            build_transport(&ws).unwrap(),
            Some(RumqttcTransport::Ws)
        ));
    }

    #[test]
    fn unreadable_tls_material_fails_instead_of_degrading() {
        let missing = "Z:/definitely/not/here.pem";

        let mut c = cfg();
        c.use_tls = true;
        c.tls_ca_path = Some(missing.into());
        let err = connect_err(&c);
        assert!(err.contains("unreadable"), "{err}");
        assert!(err.contains("definitely/not/here"), "{err}");

        let mut c = cfg();
        c.use_tls = true;
        c.tls_client_cert_path = Some(missing.into());
        c.tls_client_key_path = Some(missing.into());
        assert!(connect_err(&c).contains("certificate"));

        // WSS shares the same code path, so it must fail the same way.
        let mut c = cfg();
        c.use_tls = true;
        c.use_websocket = true;
        c.tls_ca_path = Some(missing.into());
        assert!(build_connection(&c).is_err());
    }

    #[test]
    fn half_configured_mtls_is_a_mistake_not_an_optout() {
        let mut c = cfg();
        c.use_tls = true;
        c.tls_client_cert_path = Some("Z:/client.pem".into());
        assert!(connect_err(&c).contains("without a private key"));

        let mut c = cfg();
        c.use_tls = true;
        c.tls_client_key_path = Some("Z:/client.key".into());
        assert!(connect_err(&c).contains("without a client certificate"));
    }

    /// (byte, variant) pairs straight from MQTT 5 §3.2.2.2.0, cross-checked
    /// against the table mqtt.js ships in `mqtt-packet/constants.js`. If one of
    /// these ever fails, the UI would be labelling a broker's refusal with the
    /// wrong reason — which is the whole point of surfacing them.
    #[test]
    fn suback_reason_bytes_match_the_spec() {
        use rumqttc::v5::mqttbytes::v5::SubscribeReasonCode as C;
        let table: &[(u8, C)] = &[
            (0x00, C::Success(rumqttc::v5::mqttbytes::QoS::AtMostOnce)),
            (0x01, C::Success(rumqttc::v5::mqttbytes::QoS::AtLeastOnce)),
            (0x02, C::Success(rumqttc::v5::mqttbytes::QoS::ExactlyOnce)),
            (0x80, C::Unspecified),
            (0x83, C::ImplementationSpecific),
            (0x87, C::NotAuthorized),
            (0x8F, C::TopicFilterInvalid),
            (0x91, C::PkidInUse),
            (0x97, C::QuotaExceeded),
            (0x9E, C::SharedSubscriptionsNotSupported),
            (0xA1, C::SubscriptionIdNotSupported),
            (0xA2, C::WildcardSubscriptionsNotSupported),
        ];
        for (byte, variant) in table {
            assert_eq!(&sub_code_v5(variant), byte, "variant {variant:?}");
            // Every byte we can produce must have a label, and only the ≥0x80
            // ones may be described as failures.
            assert_ne!(
                crate::acks::describe_sub(*byte),
                "unrecognized reason code",
                "byte {byte:#x}"
            );
            assert_eq!(crate::acks::is_error(*byte), *byte >= 0x80);
        }
    }

    #[test]
    fn unsuback_and_publish_reason_bytes_match_the_spec() {
        use rumqttc::v5::mqttbytes::v5::{PubAckReason, PubCompReason, PubRecReason, UnsubAckReason};
        assert_eq!(unsub_code_v5(&UnsubAckReason::Success), 0x00);
        assert_eq!(unsub_code_v5(&UnsubAckReason::NoSubscriptionExisted), 0x11);
        assert_eq!(unsub_code_v5(&UnsubAckReason::NotAuthorized), 0x87);
        assert_eq!(unsub_code_v5(&UnsubAckReason::TopicFilterInvalid), 0x8F);
        assert_eq!(unsub_code_v5(&UnsubAckReason::PacketIdentifierInUse), 0x91);
        assert_eq!(unsub_code_v5(&UnsubAckReason::UnspecifiedError), 0x80);
        assert_eq!(unsub_code_v5(&UnsubAckReason::ImplementationSpecificError), 0x83);

        assert_eq!(puback_code_v5(&PubAckReason::Success), 0x00);
        assert_eq!(puback_code_v5(&PubAckReason::NoMatchingSubscribers), 0x10);
        assert_eq!(puback_code_v5(&PubAckReason::TopicNameInvalid), 0x90);
        assert_eq!(puback_code_v5(&PubAckReason::PacketIdentifierInUse), 0x91);
        assert_eq!(puback_code_v5(&PubAckReason::QuotaExceeded), 0x97);
        assert_eq!(puback_code_v5(&PubAckReason::PayloadFormatInvalid), 0x99);
        assert_eq!(pubrec_code_v5(&PubRecReason::NotAuthorized), 0x87);
        assert_eq!(pubcomp_code_v5(&PubCompReason::Success), 0x00);
        assert_eq!(pubcomp_code_v5(&PubCompReason::PacketIdentifierNotFound), 0x92);

        // "No matching subscribers" is the case the UI must not call an error and
        // must not call a delivery either.
        assert!(!crate::acks::is_error(0x10));
        assert!(!crate::acks::is_plain_success(0x10));
        assert_eq!(crate::acks::describe_pub(0x10), "no matching subscribers");
    }

    #[test]
    fn v3_suback_codes_use_the_same_byte_space() {
        use rumqttc::mqttbytes::v4::SubscribeReasonCode as C;
        assert_eq!(sub_code_v3(&C::Success(rumqttc::QoS::AtLeastOnce)), 0x01);
        assert_eq!(sub_code_v3(&C::Success(rumqttc::QoS::ExactlyOnce)), 0x02);
        assert_eq!(sub_code_v3(&C::Failure), 0x80);
        assert!(crate::acks::is_error(sub_code_v3(&C::Failure)));
    }

    #[test]
    fn reason_strings_are_capped_because_they_are_broker_controlled() {
        let long = "x".repeat(5000);
        let props = rumqttc::v5::mqttbytes::v5::SubAckProperties {
            reason_string: Some(long.clone()),
            user_properties: Vec::new(),
        };
        let got = ack_reason_string(Some(&props)).expect("present");
        assert_eq!(got.chars().count(), 200);
        assert_ne!(got, long);

        let blank = rumqttc::v5::mqttbytes::v5::SubAckProperties {
            reason_string: Some("   ".into()),
            user_properties: Vec::new(),
        };
        assert_eq!(ack_reason_string(Some(&blank)), None);
        assert_eq!(ack_reason_string(None::<&rumqttc::v5::mqttbytes::v5::SubAckProperties>), None);
    }
}
