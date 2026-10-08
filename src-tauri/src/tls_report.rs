//! Reading the TLS material the app was pointed at, before the handshake has to fail.
//!
//! Why this exists: an expired certificate, a CA bundle that holds a leaf, or a hostname
//! that only matches the CN (which rustls ignores outright) all surface as a connection
//! failure with no pointer to the cause. MQTTX issue #1933 says it plainly -- users are
//! "forced to use alternative tools solely for debugging". The facts below are read from
//! the files themselves, so the settings pane can say "this expires in 4 days" while the
//! user is still looking at the path they just picked.
//!
//! Nothing here verifies a chain: that is rustls' job at connect time and the app already
//! hard-fails on missing or half-configured material (see `transport.rs`). This module only
//! describes what the files are, and deliberately never treats "could not read" as "fine".

use base64::Engine;
use serde::Serialize;
use x509_parser::prelude::*;

/// A leaf within this many days of expiry is reported as `expiring_soon`. Not a hard
/// threshold from any spec; chosen so a cert rotated monthly shows up while there is still
/// time to rotate it early.
pub const EXPIRING_SOON_DAYS: i64 = 30;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct CertFacts {
    pub subject: String,
    pub issuer: String,
    pub serial: String,
    pub signature_algorithm: String,
    pub not_before_secs: i64,
    pub not_after_secs: i64,
    /// Negative once past `not_after`; floor division, so 0 means "still valid today".
    pub days_left: i64,
    /// `valid` | `expiring_soon` | `expired` | `not_yet_valid`
    pub verdict: String,
    pub is_ca: bool,
    pub san_dns: Vec<String>,
    pub san_ip: Vec<String>,
    /// True only when `hostname` was given and matched a SAN entry.
    pub hostname_match: bool,
    /// The SAN pattern that matched, for display; empty when nothing matched.
    pub hostname_matched_by: String,
    /// A cert whose subject CN would match but whose SANs do not -- the classic
    /// "openssl says it is fine, the client rejects it" case.
    pub cn_would_match_but_san_rules: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SlotReport {
    pub path: String,
    /// False when the file could not be read or held no parsable certificate at all.
    pub readable: bool,
    pub certs: Vec<CertFacts>,
    /// Free-form machine codes the UI turns into sentences: `unreadable`, `noCert`,
    /// `expired`, `notYetValid`, `expiringSoon`, `caSlotHoldsLeaf`, `leafSlotHasCa`,
    /// `hostnameMismatch`, `keyNotPem`, `keyUnreadable`.
    pub problems: Vec<String>,
}

fn secs_of(dt: &x509_parser::time::ASN1Time) -> i64 {
    dt.timestamp()
}

fn days_between(later: i64, earlier: i64) -> i64 {
    (later - earlier).div_euclid(86_400)
}

/// RFC 6125-flavoured single-label wildcard: `*.example.com` matches `a.example.com` but
/// never `a.b.example.com` and never the bare `example.com`.
fn san_matches(pattern: &str, host: &str) -> bool {
    let p = pattern.trim().to_ascii_lowercase();
    let h = host.trim().to_ascii_lowercase();
    if p == h {
        return true;
    }
    if let Some(suffix) = p.strip_prefix("*.") {
        // The wildcard stands for exactly one label: whatever precedes the suffix must be
        // non-empty and contain no further dot.
        return match h.strip_suffix(&format!(".{suffix}")) {
            Some(rest) => !rest.is_empty() && !rest.contains('.'),
            None => false,
        };
    }
    false
}

fn classify(not_before: i64, not_after: i64, now: i64) -> (String, i64) {
    let days_left = days_between(not_after, now);
    if now < not_before {
        return ("not_yet_valid".to_string(), days_left);
    }
    if now > not_after {
        return ("expired".to_string(), days_left);
    }
    if days_left <= EXPIRING_SOON_DAYS {
        return ("expiring_soon".to_string(), days_left);
    }
    ("valid".to_string(), days_left)
}

fn facts_from(cert: &X509Certificate, hostname: Option<&str>, now: i64) -> CertFacts {
    let tbs = &cert.tbs_certificate;
    let subject = cert.subject().to_string();
    let issuer = cert.issuer().to_string();
    let not_before_secs = secs_of(&tbs.validity.not_before);
    let not_after_secs = secs_of(&tbs.validity.not_after);
    let (verdict, days_left) = classify(not_before_secs, not_after_secs, now);

    let mut san_dns: Vec<String> = Vec::new();
    let mut san_ip: Vec<String> = Vec::new();
    // `subject_alternative_name()` hands back the parsed extension already, so there is no
    // second parse step to do here.
    if let Ok(Some(ext)) = tbs.subject_alternative_name() {
        for name in &ext.value.general_names {
            match name {
                GeneralName::DNSName(s) => san_dns.push((*s).to_string()),
                GeneralName::IPAddress(ip) if ip.len() == 4 => {
                    if let Ok(quad) = <[u8; 4]>::try_from(*ip) {
                        san_ip.push(std::net::Ipv4Addr::from(quad).to_string());
                    }
                }
                _ => {}
            }
        }
    }

    let (hostname_match, matched_by) = match hostname {
        Some(h) if !h.trim().is_empty() => {
            let hit = san_dns.iter().find(|p| san_matches(p, h));
            let ip_hit = san_ip.iter().any(|p| p == h.trim());
            match (hit, ip_hit) {
                (Some(p), _) => (true, (*p).clone()),
                (None, true) => (true, h.trim().to_string()),
                (None, false) => (false, String::new()),
            }
        }
        _ => (false, String::new()),
    };

    // CN fallback: older toolchains and some docs still tell people "the CN is the name".
    let cn_would_match_but_san_rules =
        cn_only_match_applies(&subject, &san_dns, h_or_empty(hostname), hostname_match);

    CertFacts {
        subject,
        issuer,
        serial: cert.serial.to_str_radix(16),
        signature_algorithm: cert.signature_algorithm.algorithm.to_id_string(),
        not_before_secs,
        not_after_secs,
        days_left,
        verdict,
        is_ca: tbs.is_ca(),
        san_dns,
        san_ip,
        hostname_match,
        hostname_matched_by: matched_by,
        cn_would_match_but_san_rules,
    }
}

fn h_or_empty(h: Option<&str>) -> &str {
    h.unwrap_or("")
}

/// The classic "openssl says it is fine, the client rejects it" case: the subject CN matches
/// the host, but the certificate carries SANs -- and rustls (like every current browser)
/// ignores the CN entirely once a SAN exists. Extracted rather than inlined so the rule has
/// a test of its own instead of only being asserted through a fixture that cannot produce it.
pub fn cn_only_match_applies(subject: &str, san_dns: &[String], hostname: &str, hostname_match: bool) -> bool {
    if hostname_match || san_dns.is_empty() || hostname.trim().is_empty() {
        return false;
    }
    san_dns.iter().all(|p| !san_matches(p, hostname)) && san_matches(&cn_of(subject), hostname)
}
fn cn_of(subject: &str) -> String {
    for part in subject.split(',') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("CN=") {
            return rest.trim().to_string();
        }
        if let Some(rest) = p.strip_prefix("CN = ") {
            return rest.trim().to_string();
        }
    }
    String::new()
}

/// Every certificate in `data`, PEM (any number of blocks) or bare DER.
///
/// Returns the certs it could parse and, separately, whether *nothing* parsed -- a bundle
/// with three certs of which one is unparseable still reports the three, because that is the
/// useful answer, but `readable` is what keeps the caller from claiming the file is fine.
pub fn inspect_bytes(data: &[u8], hostname: Option<&str>, now: i64) -> (Vec<CertFacts>, bool) {
    let text = String::from_utf8_lossy(data);
    let mut out: Vec<CertFacts> = Vec::new();

    if text.contains("BEGIN CERTIFICATE") {
        for block in text.split("-----BEGIN CERTIFICATE-----").skip(1) {
            let body = block.split("-----END CERTIFICATE-----").next().unwrap_or("");
            let cleaned: String = body.chars().filter(|c| !c.is_whitespace()).collect();
            let Ok(der) = base64::engine::general_purpose::STANDARD.decode(cleaned) else {
                continue;
            };
            if let Ok((_, cert)) = X509Certificate::from_der(&der) {
                out.push(facts_from(&cert, hostname, now));
            }
        }
        return (out, true);
    }

    if let Ok((_, cert)) = X509Certificate::from_der(data) {
        out.push(facts_from(&cert, hostname, now));
        return (out, true);
    }
    (out, false)
}

fn is_key_pem(data: &[u8]) -> bool {
    let text = String::from_utf8_lossy(data);
    text.contains("PRIVATE KEY")
}

/// Build the report for one configured path. `expect_ca` says which slot the file is in, so
/// the wrong *kind* of certificate is caught rather than only the wrong validity.
pub fn inspect_file(path: &str, data: Option<&[u8]>, expect_ca: bool, hostname: Option<&str>, now: i64) -> SlotReport {
    let mut problems: Vec<String> = Vec::new();
    let Some(bytes) = data else {
        return SlotReport {
            path: path.to_string(),
            readable: false,
            certs: Vec::new(),
            problems: vec!["unreadable".to_string()],
        };
    };

    if !expect_ca && is_key_pem(bytes) {
        // A private key in a cert slot is a real and common mistake; say that, not "no cert".
        return SlotReport {
            path: path.to_string(),
            readable: true,
            certs: Vec::new(),
            problems: vec!["certSlotHoldsKey".to_string()],
        };
    }

    let (certs, readable) = inspect_bytes(bytes, hostname, now);
    if !readable || certs.is_empty() {
        problems.push("noCert".to_string());
        return SlotReport { path: path.to_string(), readable: false, certs, problems };
    }

    for c in &certs {
        match c.verdict.as_str() {
            "expired" => problems.push("expired".to_string()),
            "not_yet_valid" => problems.push("notYetValid".to_string()),
            "expiring_soon" => problems.push("expiringSoon".to_string()),
            _ => {}
        }
        if c.cn_would_match_but_san_rules {
            problems.push("cnOnlyMatch".to_string());
        }
    }

    if expect_ca {
        // A CA bundle is allowed to contain leaves (cross-signed chains legitimately do), so
        // only complain when *every* entry is a leaf -- that is the "I put server.crt in the
        // CA slot" case.
        if certs.iter().all(|c| !c.is_ca) {
            problems.push("caSlotHoldsLeaf".to_string());
        }
    } else if certs.iter().any(|c| c.is_ca) && certs.len() == 1 {
        problems.push("leafSlotHasCa".to_string());
    }

    if let Some(h) = hostname {
        if !h.trim().is_empty() && !certs.iter().any(|c| c.hostname_match) {
            problems.push("hostnameMismatch".to_string());
        }
    }

    SlotReport { path: path.to_string(), readable: true, certs, problems }
}

/// Report for the private-key slot. Only "is this even a key, and can we read it" is
/// answerable without crypto parsing, which is exactly what rustls will do at connect.
pub fn inspect_key(path: &str, data: Option<&[u8]>) -> SlotReport {
    match data {
        None => SlotReport { path: path.to_string(), readable: false, certs: Vec::new(), problems: vec!["keyUnreadable".to_string()] },
        Some(b) if is_key_pem(b) || b.starts_with(b"0\x82") => {
            SlotReport { path: path.to_string(), readable: true, certs: Vec::new(), problems: Vec::new() }
        }
        Some(_) => SlotReport {
            path: path.to_string(),
            readable: false,
            certs: Vec::new(),
            problems: vec!["keyNotPem".to_string()],
        },
    }
}

/// Certificate lifetimes are wall-clock facts, so the caller passes "now" rather than the
/// module reading a clock: that keeps every verdict in here testable.
pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Throwaway fixtures: a 10-year self-signed CA and a 90-day leaf issued by it with
    // SAN DNS:broker.test, DNS:*.test, IP:127.0.0.1. Only public certificates are checked
    // in -- the signing key is not, and nothing here needs it.
    const CA: &str = include_str!("../tests/fixtures/tls/ca.crt");
    const LEAF: &str = include_str!("../tests/fixtures/tls/leaf.crt");

    /// A moment inside the leaf's validity, derived from the fixture rather than hardcoded:
    /// these certificates were generated today, so any fixed epoch would drift the moment
    /// they are regenerated. Callers that need a clock outside the window shift this value.
    fn now() -> i64 {
        let c = &inspect_bytes(LEAF.as_bytes(), None, 0).0[0];
        (c.not_before_secs + c.not_after_secs) / 2
    }

    fn facts(data: &str, host: Option<&str>) -> Vec<CertFacts> {
        inspect_bytes(data.as_bytes(), host, now()).0
    }

    #[test]
    fn reads_subject_issuer_and_validity_out_of_a_pem_leaf() {
        let c = &facts(LEAF, None)[0];
        assert!(c.subject.contains("broker.test"), "subject: {}", c.subject);
        assert!(c.issuer.contains("DropQTT Test CA"), "issuer: {}", c.issuer);
        assert_eq!(c.verdict, "valid");
        assert!(!c.is_ca);
        assert!(c.days_left > 30, "a 90-day cert should not be near expiry: {}", c.days_left);
        assert_eq!(c.san_dns, vec!["broker.test".to_string(), "*.test".to_string()]);
        assert_eq!(c.san_ip, vec!["127.0.0.1".to_string()]);
    }

    #[test]
    fn a_ca_certificate_is_recognised_as_a_ca() {
        let c = &facts(CA, None)[0];
        assert!(c.is_ca);
        assert_eq!(c.issuer, c.subject, "self-signed means issuer equals subject");
    }

    #[test]
    fn expiry_and_clock_skew_are_verdicts_not_assumptions() {
        // Same certificate, three different clocks. Nothing here re-signs anything, so the
        // only variable is when you ask.
        let fresh = facts(LEAF, None);
        assert_eq!(fresh[0].verdict, "valid");

        let last_day = fresh[0].not_after_secs - 1;
        let l = inspect_bytes(LEAF.as_bytes(), None, last_day).0;
        assert_eq!(l[0].verdict, "expiring_soon");
        assert_eq!(l[0].days_left, 0);

        let past = inspect_bytes(LEAF.as_bytes(), None, fresh[0].not_after_secs + 3_600).0;
        assert_eq!(past[0].verdict, "expired");
        assert!(past[0].days_left <= 0, "expired must not report days remaining");

        let early = inspect_bytes(LEAF.as_bytes(), None, fresh[0].not_before_secs - 3_600).0;
        assert_eq!(early[0].verdict, "not_yet_valid", "a cert not yet valid is not 'fine'");
    }

    #[test]
    fn wildcard_san_matches_one_label_only() {
        assert!(san_matches("*.test", "a.test"));
        assert!(!san_matches("*.test", "a.b.test"), "a wildcard must not span labels");
        assert!(!san_matches("*.test", "test"), "nor match the bare parent");
        assert!(!san_matches("*.test", ".test"));
        assert!(san_matches("Broker.Test", "broker.test"), "comparison is case-insensitive");
        assert!(san_matches("exact.host", "exact.host"));
    }

    #[test]
    fn hostname_matching_prefers_san_and_reports_what_matched() {
        let one = &facts(LEAF, Some("broker.test"))[0];
        assert!(one.hostname_match);
        assert_eq!(one.hostname_matched_by, "broker.test");

        let wild = &facts(LEAF, Some("anything.test"))[0];
        assert!(wild.hostname_match);
        assert_eq!(wild.hostname_matched_by, "*.test");

        let ip = &facts(LEAF, Some("127.0.0.1"))[0];
        assert!(ip.hostname_match);

        let none = &facts(LEAF, Some("elsewhere.example"))[0];
        assert!(!none.hostname_match);
    }

    #[test]
    fn a_matching_cn_with_a_non_matching_san_is_flagged_not_ignored() {
        // The fixture cannot produce this shape (its CN and a SAN are the same name), so the
        // production rule is exercised directly on the arguments that matter.
        assert!(cn_only_match_applies(
            "CN=broker.test, O=DropQTT",
            &["other.example".to_string()],
            "broker.test",
            false
        ));
        // Already matched via SAN -> nothing to warn about.
        assert!(!cn_only_match_applies("CN=broker.test", &["broker.test".to_string()], "broker.test", true));
        // No SANs at all -> CN is legitimately the only name, and rustls does use it.
        assert!(!cn_only_match_applies("CN=broker.test", &[], "broker.test", false));
        // Neither CN nor SAN matches -> a plain mismatch, not the CN trap.
        assert!(!cn_only_match_applies("CN=somewhere.else", &["other.example".to_string()], "broker.test", false));
        // Blank host is not a request to match anything.
        assert!(!cn_only_match_applies("CN=broker.test", &["other.example".to_string()], "  ", false));
    }

    #[test]
    fn cn_is_parsed_out_of_a_stringified_subject() {
        assert_eq!(cn_of("CN=broker.test, O=DropQTT"), "broker.test");
        assert_eq!(cn_of("O=DropQTT, CN=deep.host"), "deep.host");
        assert_eq!(cn_of("O=DropQTT"), "");
    }

    #[test]
    fn a_bundle_yields_every_certificate_in_it() {
        let both = format!("{LEAF}{CA}");
        let (list, readable) = inspect_bytes(both.as_bytes(), None, now());
        assert!(readable);
        assert_eq!(list.len(), 2, "a chain file must not be read as one certificate");
        assert!(list.iter().any(|c| c.is_ca) && list.iter().any(|c| !c.is_ca));
    }

    #[test]
    fn garbage_is_reported_as_unparsable_rather_than_empty_but_ok() {
        let (list, readable) = inspect_bytes(b"not a certificate at all", None, now());
        assert!(!readable);
        assert!(list.is_empty());
    }

    #[test]
    fn the_ca_slot_holding_only_a_leaf_is_called_out() {
        let r = inspect_file("/tmp/ca-bundle.crt", Some(LEAF.as_bytes()), true, None, now());
        assert!(r.readable);
        assert!(r.problems.contains(&"caSlotHoldsLeaf".to_string()), "{:?}", r.problems);

        let bundle = format!("{LEAF}{CA}");
        let ok = inspect_file("/tmp/ca-bundle.crt", Some(bundle.as_bytes()), true, None, now());
        assert!(!ok.problems.contains(&"caSlotHoldsLeaf".to_string()), "a chain file with a CA in it is legitimate");
    }

    #[test]
    fn the_client_cert_slot_holding_a_ca_is_called_out() {
        let r = inspect_file("/tmp/client.crt", Some(CA.as_bytes()), false, None, now());
        assert!(r.problems.contains(&"leafSlotHasCa".to_string()), "{:?}", r.problems);
    }

    #[test]
    fn a_private_key_left_in_a_certificate_slot_is_named_as_such() {
        let key = "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----\n";
        let r = inspect_file("/tmp/client.crt", Some(key.as_bytes()), false, None, now());
        assert_eq!(r.problems, vec!["certSlotHoldsKey".to_string()], "not 'no cert' -- the user put the wrong file here");
    }

    #[test]
    fn an_unreadable_file_never_reads_as_clean() {
        let r = inspect_file("/tmp/missing.crt", None, true, None, now());
        assert!(!r.readable);
        assert_eq!(r.problems, vec!["unreadable".to_string()]);

        let k = inspect_key("/tmp/missing.key", None);
        assert_eq!(k.problems, vec!["keyUnreadable".to_string()]);

        let junk = inspect_key("/tmp/x.key", Some(b"plain text, no key"));
        assert!(!junk.readable);
        assert_eq!(junk.problems, vec!["keyNotPem".to_string()]);
    }

    #[test]
    fn a_key_slot_accepts_pem_and_der_shapes() {
        let pem = inspect_key("/tmp/x.key", Some("-----BEGIN RSA PRIVATE KEY-----\nAA==\n-----END RSA PRIVATE KEY-----\n".as_bytes()));
        assert!(pem.readable);
        assert!(pem.problems.is_empty());
        // PKCS#8 DER begins 0x30 0x82 (SEQUENCE, long form length).
        let der = inspect_key("/tmp/x.key", Some(&[0x30u8, 0x82, 0x01, 0x22, 0x00]));
        assert!(der.readable, "a DER key is not a broken key: {:?}", der.problems);
    }

    #[test]
    fn hostname_that_matches_nothing_marks_the_slot() {
        let r = inspect_file("/tmp/server.crt", Some(LEAF.as_bytes()), false, Some("wrong.host"), now());
        assert!(r.problems.contains(&"hostnameMismatch".to_string()), "{:?}", r.problems);

        let good = inspect_file("/tmp/server.crt", Some(LEAF.as_bytes()), false, Some("broker.test"), now());
        assert!(!good.problems.contains(&"hostnameMismatch".to_string()));
    }

    #[test]
    fn expiring_soon_is_its_own_verdict_not_a_warning_on_valid() {
        let (certs, _) = inspect_bytes(LEAF.as_bytes(), None, now());
        // days_left floors, so 31 days out is still `valid` and 30 days out is not. Getting
        // this boundary wrong by a day silently turns a warning on or off for a whole day.
        let outside = certs[0].not_after_secs - ((EXPIRING_SOON_DAYS + 1) * 86_400);
        assert_eq!(classify(certs[0].not_before_secs, certs[0].not_after_secs, outside).0, "valid");
        let inside = certs[0].not_after_secs - (EXPIRING_SOON_DAYS * 86_400);
        assert_eq!(classify(certs[0].not_before_secs, certs[0].not_after_secs, inside).0, "expiring_soon");
        assert_eq!(classify(certs[0].not_before_secs, certs[0].not_after_secs, inside).1, EXPIRING_SOON_DAYS);
    }

    #[test]
    fn an_empty_hostname_is_not_treated_as_a_mismatch() {
        let r = inspect_file("/tmp/server.crt", Some(LEAF.as_bytes()), false, Some("   "), now());
        assert!(!r.problems.contains(&"hostnameMismatch".to_string()), "{:?}", r.problems);
    }
}
