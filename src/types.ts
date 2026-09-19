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
