export interface BrokerConfig {
  host: string;
  port: number;
  useTls: boolean;
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
  qos: number;
  retain: boolean;
  timestamp: string;
  direction: 'in' | 'out';
}

/** MQTT v5 user-facing publish properties (ignored on v3.1.1) */
export interface PubProperties {
  contentType?: string;
  userProperties: [string, string][];
  messageExpiry?: number;
}

export interface ConsolePublishParams {
  topic: string;
  payloadBase64: string;
  qos: number;
  retain: boolean;
  properties: PubProperties;
}

export interface TopicSubscription {
  topic: string;
  qos: number;
  color?: string;
  createdAt?: string;
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

/** Default-filled view of a persisted rule (older saves lack new fields) */
export const bridgeRuleDefaults: Pick<
  BridgeRule,
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
