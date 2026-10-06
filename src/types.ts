export interface BrokerConfig {
  host: string;
  port: number;
  useTls: boolean;
  /** Route over WebSocket/WSS instead of raw TCP */
  useWebsocket?: boolean;
  clientId: string;
  username?: string;
  password?: string;
  /**
   * Pointer to the password inside the OS credential store. Once this is set the
   * password is not persisted: the backend resolves the reference when it opens the
   * socket, so the plaintext never comes back to JavaScript. `password` on its own is
   * still honoured, which is how the CLI and a machine without a keyring connect.
   */
  secretRef?: string;
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
  /** v5 will Payload Format Indicator: 0 = bytes, 1 = UTF-8 */
  willPayloadFormat?: number;
  /** v5 will Message-Expiry-Interval; 0 is a real value, not "unset" */
  willMessageExpiry?: number;
  willResponseTopic?: string;
  willCorrelationData?: string;
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
  /** Correlation data as hex of the raw bytes; lossless even when it is not text */
  correlationHex?: string;
  /** MQTT5 Payload Format Indicator as published: 0 = bytes, 1 = UTF-8 */
  payloadFormat?: number;
  /** Which registered subscriptions this delivery arrived through. */
  matchedFilters?: string[];
  /** The raw Subscription Identifiers behind `matchedFilters`, when the broker sent any. */
  subscriptionIds?: number[];
  qos: number;
  retain: boolean;
  timestamp: string;
  /** Epoch milliseconds captured by the Rust event path. */
  timestampMs?: number;
  direction: 'in' | 'out';
  /** Verdict from the message-assertion rules, computed live as the row routed.
   * Replayed history rows carry none — the rules may have changed since. */
  assertion?: AssertionVerdict;
}

/** What an assertion reads: a whole-message field, or a JSON path into the payload. */
export type AssertionField =
  | 'payload'
  | 'topic'
  | 'qos'
  | 'retain'
  | 'size'
  | 'contentType'
  | 'direction'
  | { json: string };

export type AssertionOp =
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'eq'
  | 'ne'
  | 'contains'
  | 'notContains'
  | 'present'
  | 'absent';

/** Three outcomes, not two: a rule that cannot read the message says so. */
export type AssertOutcome = 'passed' | 'violated' | 'unevaluable';

export interface AssertionRule {
  id: string;
  filter: string;
  field: AssertionField;
  op: AssertionOp;
  expected: string;
  enabled: boolean;
  label: string;
  /** The predicate as typed; absent for rules imported from an older save. */
  text?: string;
}

export interface AssertionVerdict {
  outcome: AssertOutcome;
  ruleId: string;
  label: string;
  /** The line that decided it, e.g. `$.tempC < 80`. */
  expr: string;
  /** How many armed rules claimed this row; >1 means the badge summarises them. */
  rules: number;
}

export interface AssertionViolation {
  msgId: string;
  topic: string;
  ruleId: string;
  expr: string;
  outcome: AssertOutcome;
  tsMs: number;
}

export interface AssertStats {
  matched: number;
  passed: number;
  violated: number;
  unevaluable: number;
}

export interface AssertionSnapshot {
  stats: AssertStats;
  rules: number;
  recent: AssertionViolation[];
}

export const emptyAssertStats: AssertStats = { matched: 0, passed: 0, violated: 0, unevaluable: 0 };

export type FaultDirection = 'inbound' | 'outbound' | 'both';

/** A fault-injection rule. Rates are a stride, not a coin flip: 25 drops exactly
 * every fourth matching message, so a loss test reproduces. */
export interface FaultRule {
  id: string;
  name: string;
  filter: string;
  direction: FaultDirection;
  enabled: boolean;
  dropPct: number;
  delayMs: number;
  duplicatePct: number;
  corruptPct: number;
  /** Inbound only: flips MQTT5 Correlation Data so a response stops matching. */
  badCorrelationPct: number;
}

export const faultRuleDefaults: Omit<FaultRule, 'id' | 'name' | 'filter'> = {
  direction: 'inbound',
  enabled: true,
  dropPct: 0,
  delayMs: 0,
  duplicatePct: 0,
  corruptPct: 0,
  badCorrelationPct: 0,
};

export interface FaultCounts {
  seen: number;
  dropped: number;
  delayed: number;
  duplicated: number;
  corrupted: number;
  misCorrelated: number;
}

export interface FaultRuleStats {
  id: string;
  name: string;
  filter: string;
  enabled: boolean;
  counts: FaultCounts;
}

export const emptyFaultCounts: FaultCounts = {
  seen: 0,
  dropped: 0,
  delayed: 0,
  duplicated: 0,
  corrupted: 0,
  misCorrelated: 0,
};

/** Actions a rule actually took, for the "is this us or the network?" readout. */
export const faultActionTotal = (counts: FaultCounts): number =>
  counts.dropped + counts.delayed + counts.duplicated + counts.corrupted + counts.misCorrelated;

/** A scripted responder: answer traffic that matches `trigger` with a reply. */
export interface ResponderRule {
  id: string;
  name: string;
  /** Inbound filter that starts a reply. */
  trigger: string;
  /** Topic template; `${topic}` and `${payload}` are substituted per message. */
  replyTopic: string;
  replyPayload: string;
  qos: number;
  retain: boolean;
  delayMs: number;
  /** 0 means only the engine-wide ceiling applies. */
  maxPerSec: number;
  enabled: boolean;
}

export const responderRuleDefaults: Omit<ResponderRule, 'id' | 'trigger'> = {
  name: '',
  replyTopic: '',
  replyPayload: '{"ok":true}',
  qos: 1,
  retain: false,
  delayMs: 0,
  maxPerSec: 0,
  enabled: true,
};

export interface ResponderStats {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  matched: number;
  replied: number;
  throttled: number;
  /** Deliveries skipped because this app answered them a moment ago */
  suppressed: number;
  failed: number;
  lastError?: string | null;
}

/** MQTT v5 user-facing publish properties (ignored on v3.1.1) */
export interface PubProperties {
  contentType?: string;
  userProperties: [string, string][];
  messageExpiry?: number;
  responseTopic?: string;
  correlationData?: string;
  /** Correlation data as hex of raw bytes. Sent instead of `correlationData` when
   *  the value is not text, so a bridge hop does not lose it. */
  correlationHex?: string;
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
  /** Fan-out width: how many `${device}` indices each tick emits to (1..200). */
  devices?: number;
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
  /** Acceptance bar; absent means "no verdict", not "passed". */
  expect?: BenchExpect;
  /** Default true. False keeps this traffic out of the console feed and history. */
  mirror?: boolean;
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
  /** PUBACK (QoS1) / PUBCOMP (QoS2) received for this run's publishes, each one
   *  carrying a plain success reason */
  acked: number;
  /** Publishes the broker refused with a reason code of 0x80 or above */
  nacked: number;
  /** Publishes accepted with "no matching subscribers" — kept, but delivered to nobody */
  noSubscribers: number;
  observed: number;
  elapsedMs: number;
  status: BenchStatus;
  lastError?: string;
  latency: LatencySummary;
  /** The bar this run was started with, echoed back. */
  expect?: BenchExpect;
  /** False while the run is deliberately not mirrored into feed/history. */
  mirror: boolean;
  /** Absent when no bar was set. */
  verdict?: BenchVerdict;
}

/** Acceptance thresholds for a bench run; every field is optional. */
export interface BenchExpect {
  minRate?: number;
  maxP99Ms?: number;
  maxLost?: number;
}

export interface BenchFailure {
  kind: 'minRate' | 'maxP99Ms' | 'maxLost';
  limit: number;
  /** `null` when the measurement does not exist (a latency bar, no samples). */
  actual: number | null;
}

export interface BenchVerdict {
  /** False while the run is still going: a sample is not a pass/fail statement. */
  settled: boolean;
  failures: BenchFailure[];
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

/** One entry of `SubscriptionAckState.capped`. */
export interface CappedSub {
  filter: string;
  granted: number;
}

/** Everything the backend knows about broker ack verdicts. */
export interface SubscriptionAckState {
  rejected?: SubRejection[];
  refusedUnsubscribes?: SubRejection[];
  capped?: CappedSub[];
  unattributed?: number;
}

/** Payload of the `subscription-downgraded` event. */
export interface QosDowngradeEvent {
  filter: string;
  asked: number;
  granted: number;
}

/** A subscription (or unsubscribe) the broker refused, with the reason byte. */
export interface SubRejection {
  filter: string;
  /** Raw wire reason code, localized by `describeAck` */
  code: number;
  /** English fallback straight from the backend; the UI prefers `code` */
  meaning: string;
  reasonString?: string | null;
  atMs: number;
}

export interface TopicSubscription {
  topic: string;
  qos: number;
  color?: string;
  createdAt?: string;
  /** Absent on subscriptions saved before v5 options existed. */
  options?: SubOptions;
}

/** Rolling timing for one repeating operation inside the app. */
export interface DurationStats {
  /** Samples inside the window (grows to 256, then stays) */
  window: number;
  /** Calls recorded since start, never trimmed */
  totalCalls: number;
  avgMs: number;
  maxMs: number;
}

/** What the connected broker announced in its CONNACK (v5 properties). */
export interface BrokerCapabilities {
  topicAliasMax: number;
  maxQos: number;
  retainAvailable: boolean;
  wildcardAvailable: boolean;
  sharedAvailable: boolean;
  subscriptionIdsAvailable: boolean;
  receiveMax: number;
  maxPacketSize?: number | null;
  serverKeepAlive?: number | null;
  sessionExpiry?: number | null;
  assignedClientId?: string | null;
  responseInformation?: string | null;
  serverReference?: string | null;
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

/** A history row that joined a trace, with the claim that pulled it in. */
export interface TraceHit extends HistoryRow {
  /** `correlation` is the same message; `topic` / `payload` merely mention it */
  matchedBy: 'correlation' | 'topic' | 'payload' | string;
}

export interface TraceSummary {
  count: number;
  topics: string[];
  firstMs: number | null;
  lastMs: number | null;
  inbound: number;
  outbound: number;
  /** Distinct correlation keys, lowercase hex. More than one is several stories. */
  correlations: string[];
  truncated: boolean;
}

export interface TraceResult {
  /** Oldest first — a life story is read forward, unlike the history list. */
  hits: TraceHit[];
  summary: TraceSummary;
}

export interface HistoryStats {
  rows: number;
  inbound: number;
  outbound: number;
  oldestTs?: number | null;
  newestTs?: number | null;
  /** Rows the best-effort write path could not persist this session */
  lostRows?: number;
  /** Age limit in days; 0 means only the row cap trims */
  retentionDays?: number;
  /** Rows the age policy deleted this session. Pruned history is still gone. */
  prunedRows?: number;
}

/** One topic's share of a time window, from `history_topics`. */
export interface HistoryTopicRow {
  topic: string;
  count: number;
  inbound: number;
  outbound: number;
  bytes: number;
  firstTs: number;
  lastTs: number;
}

// ---- Activity timeline (`history_timeline`) ----

/** One uninterrupted stretch of traffic from one entity. */
export interface TimelineSegment {
  startMs: number;
  endMs: number;
  messages: number;
}

/** A request that expected an answer, seen inside the window. */
export interface TimelineMark {
  tsMs: number;
  topic: string;
  /** Correlation as lowercase hex of its bytes, which is how it is stored. */
  correlation: string | null;
  /** False means no answer arrived in this window, not that none ever did. */
  answered: boolean;
  rttMs: number | null;
}

export interface TimelineEntity {
  entity: string;
  segments: TimelineSegment[];
  marks: TimelineMark[];
  messages: number;
  firstMs: number;
  lastMs: number;
  longestGapMs: number;
}

export interface TimelineResult {
  entities: TimelineEntity[];
  windowStartMs: number;
  windowEndMs: number;
  gapMs: number;
  depth: number;
  entitiesDropped: number;
  rowsScanned: number;
  truncated: boolean;
}

// ---- MQTT5 request / response ----

export type RpcState = 'pending' | 'resolved' | 'timeout';

export interface RpcReply {
  topic: string;
  payloadBase64: string;
  payloadLen: number;
  qos: number;
  retain: boolean;
  /** Reply correlation as hex of the bytes that arrived, or null when the reply
   *  carried none — which is why the pairing may be marked `pairedByPosition`. */
  correlationHex?: string | null;
  contentType?: string | null;
  timestampMs: number;
}

export interface RpcCall {
  id: string;
  requestTopic: string;
  responseTopic: string;
  correlation: string;
  sentAtMs: number;
  timeoutMs: number;
  state: RpcState;
  rttMs?: number | null;
  reply?: RpcReply | null;
  /** The reply carried no correlation data, so it was paired by send order */
  pairedByPosition: boolean;
  /** Which send this is, 0-based; a retry keeps the same correlation id */
  attempt?: number;
  attemptsTotal?: number;
  /** A broadcast request stays open until this many answers arrive */
  expected?: number;
  /** Every answer received, in arrival order; `reply` stays the first */
  replies?: RpcReply[];
}

/** What the publisher sends when "wait for the answer" is on. */
export interface RpcSpec {
  topic: string;
  payloadBase64: string;
  qos: number;
  retain: boolean;
  timeoutMs: number;
  responseTopic?: string;
  correlationData?: string;
  contentType?: string;
  userProperties?: [string, string][];
  payloadFormat?: number;
  topicAlias?: number;
  messageExpiry?: number;
  /** Sends before the request is written off; 1 = no retry */
  attempts?: number;
  /** Answers to wait for on a broadcast; 1 = one-to-one */
  collect?: number;
}

export interface RpcEvent {
  kind: 'resolved' | 'timeout' | 'retry' | 'partial';
  call: RpcCall;
}

// ---- Operations diagnostics ----

export interface RuntimeInfo {
  appVersion: string;
  os: string;
  arch: string;
  generatedAt: number;
  /** Seconds this process has been alive; a fall means a restart reset the totals. */
  uptimeSecs?: number;
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
  /** Sends whose peer never sent a receipt, this session */
  confirmTimeouts: number;
  rpcPending?: number;
  rpcTimeouts?: number;
  /** Subscriptions the broker refuses right now (SUBACK >= 0x80) */
  subscriptionsRejected?: number;
  /** Unsubscribes the broker refused; delivery may continue regardless */
  unsubscribesRejected?: number;
  /** Ack reason bytes that answered nothing we had asked about */
  acksUnattributed?: number;
  /** Publishes refused by the broker this session */
  publishRejected?: number;
  /**
   * Lifetime publish counts. Optional in the type the way every other field here is,
   * so an older snapshot (or a test mock) still compiles; the backend always sends
   * both. They are the only message counts that never go backwards.
   */
  receivedTotal?: number;
  sentTotal?: number;
  /** Our own timings, over the last 256 calls of each operation */
  feedFlush?: DurationStats;
  feedLag?: DurationStats;
  historyWrite?: DurationStats;
  /** Fault rules armed right now; non-zero means this session's losses are ours */
  faultRules?: number;
  faultActions?: number;
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

/** State of the loopback Prometheus endpoint. Off is the only state at launch. */
export interface MetricsStatus {
  enabled: boolean;
  port: number;
  /** Quoted from the backend so the port box cannot accept a value `configure` rejects. */
  minPort: number;
}

/**
 * Whether broker passwords can be kept in the OS credential store on this machine.
 * `supported` is about the build, `available` about right now (a locked keychain is
 * supported but unavailable), and `reason` is written to be shown to the user.
 */
export interface SecretStatus {
  available: boolean;
  supported: boolean;
  reason?: string;
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
  /**
   * Extra sinks the same message fans out to. Each is delivered and retried on
   * its own, because one endpoint being down is not the others' excuse. Optional
   * so rules written before fan-out keep loading unchanged.
   */
  targets?: { url: string; format: 'raw' | 'json'; headers: [string, string][] }[];
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

/**
 * How many extra sinks one rule may fan out to. This mirrors
 * `webhook::MAX_EXTRA_TARGETS` in Rust, which is the authority: a larger set is
 * rejected on sync with the reason, so the form only uses this to stop asking.
 */
export const BRIDGE_MAX_EXTRA_SINKS = 7;

/** Default-filled view of a persisted rule (older saves lack new fields) */
export const bridgeRuleDefaults: Pick<
  BridgeRule,
  | 'targetKind'
  | 'webhook'
  | 'targets'
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
  targets: [],
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
  /** Webhook bodies still owed a delivery, and dead letters that stopped trying */
  queued?: number;
  dead?: number;
}

export interface BridgeOutboxCounts {
  pending: number;
  dead: number;
  delivered: number;
  retries: number;
}

/** One queued debt as the panel sees it: enough to point at it, never the body. */
export interface BridgeOutboxPreviewRow {
  ruleId: string;
  topic: string;
  attempts: number;
  lastError: string;
  /** Which sink of the rule is owed; 0 is its primary webhook. */
  targetIndex: number;
}

export interface BridgeOutboxState {
  counts: BridgeOutboxCounts;
  /** Set when retries are off because the queue could not be opened */
  error?: string | null;
  preview: BridgeOutboxPreviewRow[];
  /** The backend's own attempt cap — the panel prints it, so it must not be a guess */
  maxAttempts: number;
}

export const emptyBridgeOutboxState: BridgeOutboxState = {
  counts: { pending: 0, dead: 0, delivered: 0, retries: 0 },
  error: null,
  preview: [],
  maxAttempts: 0,
};

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
  /**
   * All bytes left this machine but the peer never confirmed. Deliberately not
   * folded into 'failed': the send may well have succeeded.
   */
  status: 'pending' | 'sending' | 'completed' | 'unconfirmed' | 'failed';
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
