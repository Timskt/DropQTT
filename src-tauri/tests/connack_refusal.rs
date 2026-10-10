//! A refused CONNACK, over a real socket.
//!
//! Both halves of the fix rest on a claim about somebody else's code: that rumqttc turns a
//! failed CONNACK into an ordinary connection error and reconnects on the next poll, so one
//! under-privileged account becomes a link that drops once per second. Reading
//! `rumqttc-0.24.0/src/eventloop.rs:472` proves it today; this proves it against the thing
//! itself, and pins the byte the classification consumes. Its own test binary because it
//! opens a listening socket, which the lib's test harness has never needed.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dropqtt_lib::acks::connack_is_terminal;
use dropqtt_lib::protocol::BrokerConfig;
use dropqtt_lib::transport::{build_connection, AckStage, NetEvent};

/// Answers every CONNECT with `not authorized` (v3.1.1 return code 5) and hangs up, which
/// is what a spec-compliant broker does — MQTT 3.1.1 §3.2: the server MUST close the
/// connection after a CONNACK that is not accepted. Closing matters for what is being
/// measured: without it the client would sit on a half-open socket instead of retrying.
fn refusing_broker() -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind an ephemeral port");
    let port = listener.local_addr().unwrap().port();
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = attempts.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            // Read the fixed header, then exactly the declared remainder, so the peer
            // sees a complete CONNECT before it gets its refusal.
            let mut head = [0u8; 2];
            if stream.read_exact(&mut head).is_err() {
                continue;
            }
            let mut remaining: usize = 0;
            let mut shift = 0;
            loop {
                let mut byte = [0u8; 1];
                if stream.read(&mut byte).unwrap_or(0) == 0 {
                    break;
                }
                remaining |= ((byte[0] & 0x7f) as usize) << shift;
                shift += 7;
                if byte[0] & 0x80 == 0 {
                    break;
                }
            }
            let mut body = vec![0u8; remaining.min(4096)];
            let _ = stream.read(&mut body);
            counter.fetch_add(1, Ordering::SeqCst);
            let _ = stream.write_all(&[0x20, 0x02, 0x00, 0x05]);
            let _ = stream.flush();
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
    });
    (port, attempts)
}

#[tokio::test]
async fn a_refused_connack_reaches_the_app_named_and_the_client_keeps_retrying() {
    let (port, attempts) = refusing_broker();
    let config = BrokerConfig {
        host: "127.0.0.1".into(),
        port,
        client_id: "dropqtt-refusal-probe".into(),
        username: Some("gateuser".into()),
        password: Some("not-the-right-one".into()),
        protocol_version: 3,
        keep_alive_secs: 60,
        ..Default::default()
    };
    let (_client, mut eventloop) = build_connection(&config).expect("build the link");

    let first = tokio::time::timeout(Duration::from_secs(5), eventloop.poll())
        .await
        .expect("no event at all from a broker that answered");
    match first {
        NetEvent::AckRejected { stage, code, .. } => {
            assert_eq!(stage, AckStage::Connect, "a refusal was not marked as a CONNACK");
            assert_eq!(code, 0x05, "return code 5 did not survive normalization as 0x05");
            assert!(connack_is_terminal(code), "0x{code:02X} is not terminal — the loop would retry a refusal that cannot change");
        }
        other => panic!("a refused CONNACK reached the app as {other:?}, not a refusal"),
    }

    // The premise, measured rather than assumed: keep polling the way both event loops
    // do and the broker sees the same CONNECT again. Nothing in rumqttc stops it, so the
    // stop has to live in this app — which is exactly where the fix put it.
    //
    // v3.1.1 turns out to retry *tighter* than the once-a-second the v5 path produces:
    // `EventLoop::poll` propagates the refusal before it stores the network handle
    // (`eventloop.rs:150-153`), so the next poll reconnects with no error event in
    // between at all. The claim worth pinning is therefore not "an error came first" but
    // "a session that was refused never once reported itself connected" — which is what
    // the app used to show the user.
    let mut connected_after_refusal = false;
    let until = tokio::time::Instant::now() + Duration::from_secs(8);
    while tokio::time::Instant::now() < until && attempts.load(Ordering::SeqCst) < 2 {
        if let NetEvent::Connected(_) = tokio::time::timeout(Duration::from_secs(2), eventloop.poll())
            .await
            .unwrap_or(NetEvent::Other)
        {
            connected_after_refusal = true;
        }
    }
    let seen = attempts.load(Ordering::SeqCst);
    assert!(seen >= 2, "the client sent {seen} CONNECT and stopped — the flap this test \
        exists to prove no longer happens, so the caller-side stop needs re-examining");
    assert!(
        !connected_after_refusal,
        "a broker that refused the CONNECT reported a live session after the refusal"
    );
}
