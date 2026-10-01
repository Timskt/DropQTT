export interface BrokerConfig {
  host: string;
  port: number;
  useTls: boolean;
  /** Route over WebSocket/WSS instead of raw TCP */
  useWebsocket?: boolean;
  clientId: string;
  username?: string;
  password?: string;
  keepAliveSecs: number;
  defaultQos: number;
  baseTopic?: string;
  /** 3 => MQTT v3.1.1, 5 => MQTT v5.0 */
  protocolVersion?: number;
  /** MQTT 3.1.1 clean_session / MQTT 5 clean_start */
  cleanSession?: boolean;
  // ---- Last Will & Testament ----
  willTopic?: string;
  willPayload?: string;
  willQos?: number;
  willRetain?: boolean;
  /** MQTT5 Will Delay Interval (seconds); absent keeps the property off the wire */
  willDelaySecs?: number;
  /** MQTT5 content type declared by the will message */
  willContentType?: string;
  /** MQTT5 Session-Expiry-Interval on CONNECT (seconds) */
  sessionExpirySecs?: number;
  // ---- mTLS / custom trust (PEM file paths) ----
  tlsCaPath?: string;
  tlsClientCertPath?: string;
  tlsClientKeyPath?: string;
}

export interface BrokerProfile {
  id: string;
  name: string;
  config: BrokerConfig;
}

export interface ConnectionStatus {
  connected: boolean;
  brokerHost: string;
  brokerPort: number;
  clientId: string;
}

export type TransferStatus =
  | 'transferring'
  | 'paused'
  | 'verifying'
  | 'awaiting_approval'
  | 'sent'
  /** Every chunk left the sender, but the peer never sent its receipt. */
  | 'confirm_timeout'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface TransferProgress {
  transferId: string;
  channel: string;
  fileName: string;
  direction: 'send' | 'receive';
  bytesTransferred: number;
  totalBytes: number;
  chunksTransferred: number;
  totalChunks: number;
  speedBps: number;
  status: TransferStatus;
  errorMessage?: string;
  sha256: string;
  savePath?: string;
}

export interface MqttGenericMessage {
  id: string;
  topic: string;
  payload: string;
  payloadLen: number;
  /** Raw bytes, base64 (possibly truncated when very large) */
  payloadBase64: string;
  truncated: boolean;
  contentType?: string;
  userProperties?: [string, string][];
  responseTopic?: string;
  correlationData?: string;
  /** MQTT5 Payload Format Indicator as published: 0 = bytes, 1 = UTF-8 */
  payloadFormat?: number;
  qos: number;
  retain: boolean;
  timestamp: string;
  /** Epoch milliseconds captured by the Rust event path. */
  timestampMs?: number;
  direction: 'in' | 'out';
}

/** MQTT v5 user-facing publish properties (ignored on v3.1.1) */
export interface PubProperties {
  contentType?: string;
  userProperties: [string, string][];
  messageExpiry?: number;
  responseTopic?: string;
  correlationData?: string;
  /** MQTT5 Payload Format Indicator: 0 = bytes, 1 = UTF-8, undefined = unset */
  payloadFormat?: number;
  /** MQTT5 Topic Alias (1..65535) */
  topicAlias?: number;
}

export interface ConsolePublishParams {
  topic: string;
  payloadBase64: string;
  qos: number;
  retain: boolean;
  properties: PubProperties;
}

// ---- Backend-scheduled publishing ----

/** One scheduled publish: a payload template replayed on a fixed cadence. */
export interface ScheduleSpec {
  id: string;
  topic: string;
  /** Editor text; `${...}` tokens are substituted by the backend per fire */
  payload: string;
  format: string;
  intervalMs: number;
  /** Total messages to send; 0 = until stopped */
  count: number;
  qos: number;
  retain: boolean;
  properties: PubProperties;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';
/** Live state of one run as reported by the scheduler registry. */
export interface RunInfo {
  id: string;
  topic: string;
  format: string;
  intervalMs: number;
  count: number;
  qos: number;
  retain: boolean;
  sent: number;
  errors: number;
  status: RunStatus;
  lastError?: string;
  startedAtMs: number;
  lastFireMs?: number;
}

// ---- Built-in publish stress lab ----

export interface BenchSpec {
  id: string;
  /** Round-robin across these exact topics */
  topics: string[];
  /** Total messages per second across all topics */
  rate: number;
  size: number;
  qos: number;
  retain: boolean;
  /** 0 = until stopped */
  durationSec: number;
}

export interface LatencySummary {
  samples: number;
  dropped: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
}

export type BenchStatus = 'running' | 'finished' | 'stopped' | 'failed';

export interface BenchProgress {
  id: string;
  topics: string[];
  rate: number;
  size: number;
  qos: number;
  retain: boolean;
  sent: number;
  /** PUBACK (QoS1) / PUBCOMP (QoS2) received for this run's publishes */
  acked: number;
  observed: number;
  elapsedMs: number;
  status: BenchStatus;
  lastError?: string;
  latency: LatencySummary;
}

/** MQTT v5 subscription options; ignored by the backend on v3.1.1 links. */
export interface SubOptions {
  qos: number;
  noLocal: boolean;
  retainAsPublished: boolean;
  /** 0 = send retained on every subscribe, 1 = only on new subscription, 2 = never */
  retainHandling: number;
}

export const subOptionsDefaults = (qos = 1): SubOptions => ({
  qos,
  noLocal: false,
  retainAsPublished: false,
  retainHandling: 0,
});

export interface TopicSubscription {
  topic: string;
  qos: number;
  color?: string;
  createdAt?: string;
  /** Absent on subscriptions saved before v5 options existed. */
  options?: SubOptions;
}

/** One broker $SYS health metric line */
export interface SysRow {
  topic: string;
  value: string;
  lastSeen: number;
}

// ---- Persistent message history (SQLite) ----

export interface HistoryRow {
  id: string;
  topic: string;
  payload: string;
  payloadBase64: string;
  payloadLen: number;
  qos: number;
  retain: boolean;
  contentType?: string | null;
  properties: PubProperties;
  truncated: boolean;
  direction: string;
  /** Epoch milliseconds */
  ts: number;
}

export interface HistorySeriesPoint {
  bucket: number;
  count: number;
}

export interface HistoryStats {
  rows: number;
  inbound: number;
  outbound: number;
  oldestTs?: number | null;
  newestTs?: number | null;
}

// ---- Operations diagnostics ----

export interface RuntimeInfo {
  appVersion: string;
  os: string;
  arch: string;
  generatedAt: number;
}

export interface MqttDiagnostics {
  configured: boolean;
  connected: boolean;
  host: string;
  port: number;
  clientId: string;
  useTls: boolean;
  useWebsocket: boolean;
  protocolVersion: number;
  subscriptions: number;
  incomingActive: number;
  outgoingActive: number;
  feedBuffered: number;
  feedBufferCapacity: number;
  feedDropped: number;
  /** Non-zero when overload also escaped SQLite retention. */
  feedLost: number;
  topicStatsCount: number;
  /** Backend-scheduled publishes still running */
  scheduledRuns: number;
  /** Bench lab runs still publishing */
  benchRuns: number;
  historyAvailable: boolean;
  history: HistoryStats;
  downloadDir: string;
  downloadDirWritable: boolean;
  downloadDirError?: string | null;
}

export interface BridgeDiagnostics {
  totalConnections: number;
  connectedConnections: number;
  configuredRules: number;
  enabledRules: number;
  forwarded: number;
  errors: number;
  dropped: number;
}

export type DiagnosticLevel = 'ok' | 'warn' | 'error';

export interface DiagnosticCheck {
  id: string;
  level: DiagnosticLevel;
  detail: string;
}

export interface DiagnosticsSnapshot {
  runtime: RuntimeInfo;
  mqtt: MqttDiagnostics;
  bridge: BridgeDiagnostics;
  checks: DiagnosticCheck[];
}

/** Batched console-feed emission from the backend (100 ms cadence) */
export interface FeedBatch {
  /** Oldest-first; the feed renders newest on top */
  messages: MqttGenericMessage[];
  /** Cumulative feed drops under overload (traffic stats stay exact) */
  dropped: number;
}

/** Live per-topic traffic snapshot (backend-second-window based) */
export interface TopicStatRow {
  topic: string;
  /** Total messages received since last reset */
  count: number;
  /** Total payload bytes received */
  bytes: number;
  /** Messages in the last completed second */
  rate: number;
  /** Payload bytes in the last completed second */
  bytesRate: number;
  /** Highest per-second message rate ever observed */
  peakRate: number;
  peakBytesRate: number;
  /** Unix seconds of the last received message */
  lastSeen: number;
}

// ---- Bridge (broker-to-broker forwarding) ----

export type BridgeTopicMode = 'same' | 'prefix' | 'fixed' | 'regex' | 'map';
export type BridgeQosMode = 'source' | 'fixed';
export type BridgeRetainMode = 'source' | 'on' | 'off';

/** One "from => to" row of the map topic-rewrite mode */
export interface TopicMapEntry {
  from: string;
  to: string;
}

export interface BridgeRule {
  id: string;
  name: string;
  /** Logical bridge connection id acting as the message source */
  sourceConn: string;
  /** Source topic filter ('+' / '#' wildcards allowed) */
  sourceFilter: string;
  sourceQos: number;
  targetConn: string;
  targetKind: 'mqtt' | 'http';
  webhook: { url: string; format: 'raw' | 'json'; headers: [string, string][] };
  topicMode: BridgeTopicMode;
  prefixFrom: string;
  prefixTo: string;
  /** Target topic when topicMode === 'fixed' (aggregation) */
  fixedTopic: string;
  /** Regex pattern + replacement ($1 groups) when topicMode === 'regex' */
  regexPattern: string;
  regexReplacement: string;
  /** Per-topic mapping rows when topicMode === 'map' */
  topicMap: TopicMapEntry[];
  /** JS "function transform(topic, payload, qos, retain)" rewriting the payload */
  transformScript: string;
  /** Wildcard filters whose matching topics are NOT forwarded */
  excludeFilters: string[];
  /** Literal text prepended / appended to the forwarded payload */
  payloadPrefix: string;
  payloadSuffix: string;
  /** Wrap payload into JSON envelope {topic, ts, payload|payloadB64} */
  wrapJson: boolean;
  /** Max messages forwarded per second (0 = unlimited) */
  rateLimit: number;
  qosMode: BridgeQosMode;
  fixedQos: number;
  retainMode: BridgeRetainMode;
  /** Forward MQTT5 content-type / user properties */
  forwardProps: boolean;
  enabled: boolean;
}

/** A silence-watchdog rule: alert when a topic filter stops carrying traffic. */
export interface SilenceRule {
  id: string;
  name: string;
  topicFilter: string;
  /** Seconds of quiet before alerting; backend floor is 5. */
  timeoutSec: number;
  /** Minimum gap between alerts for one continuous outage. */
  cooldownSec: number;
  enabled: boolean;
  webhook: { url: string; format: 'raw' | 'json'; headers: [string, string][] };
}

export const silenceRuleDefaults: Omit<SilenceRule, 'id' | 'name' | 'topicFilter'> = {
  timeoutSec: 60,
  cooldownSec: 300,
  enabled: true,
  webhook: { url: '', format: 'json', headers: [] },
};

/** Emitted by the backend after each alert attempt. */
export interface SilenceAlertEvent {
  ruleId: string;
  ruleName: string;
  topicFilter: string;
  silentForSec: number;
  ok: boolean;
  error?: string | null;
  target: string;
  timestamp: string;
}

/** Default-filled view of a persisted rule (older saves lack new fields) */
export const bridgeRuleDefaults: Pick<
  BridgeRule,
  | 'targetKind'
  | 'webhook'
  | 'fixedTopic'
  | 'regexPattern'
  | 'regexReplacement'
  | 'topicMap'
  | 'transformScript'
  | 'excludeFilters'
  | 'payloadPrefix'
  | 'payloadSuffix'
  | 'wrapJson'
  | 'rateLimit'
> = {
  targetKind: 'mqtt',
  webhook: { url: '', format: 'json', headers: [] },
  fixedTopic: '',
  regexPattern: '',
  regexReplacement: '',
  topicMap: [],
  transformScript: '',
  excludeFilters: [],
  payloadPrefix: '',
  payloadSuffix: '',
  wrapJson: false,
  rateLimit: 0,
};

export interface BridgeConnInfo {
  id: string;
  connected: boolean;
  brokerHost: string;
  brokerPort: number;
  clientId: string;
  error?: string | null;
}

export interface BridgeRuleStats {
  forwarded: number;
  errors: number;
  /** Skipped by exclusion filters or rate limiting */
  dropped: number;
  lastTopic: string;
}

export interface BridgeEvent {
  ruleId: string;
  ruleName: string;
  fromTopic: string;
  toTopic: string;
  bytes: number;
  qos: number;
  retain: boolean;
  ok: boolean;
  error?: string | null;
  timestamp: string;
}

export interface BatchFileItem {
  id: string;
  path: string;
  name: string;
  size: number;
  status: 'pending' | 'sending' | 'completed' | 'failed';
  progress?: number;
  speedBps?: number;
  transferId?: string;
  error?: string;
}

export const BROKER_PRESETS: { name: string; host: string; port: number; useTls: boolean; baseTopic?: string }[] = [
  { name: 'EMQX Public', host: 'broker.emqx.io', port: 1883, useTls: false, baseTopic: 'dropqtt' },
  { name: 'HiveMQ Public', host: 'broker.hivemq.com', port: 1883, useTls: false, baseTopic: 'dropqtt' },
  { name: 'Mosquitto Public', host: 'test.mosquitto.org', port: 1883, useTls: false, baseTopic: 'dropqtt' },
  { name: 'Localhost (1883)', host: '127.0.0.1', port: 1883, useTls: false, baseTopic: 'dropqtt' },
];

export const DEFAULT_BROKER_CONFIG: BrokerConfig = {
  host: 'broker.emqx.io',
  port: 1883,
  useTls: false,
  clientId: `DropQTT_${Math.random().toString(36).substring(2, 8)}`,
  keepAliveSecs: 60,
  defaultQos: 1,
  baseTopic: 'dropqtt',
  protocolVersion: 3,
  cleanSession: true,
};
