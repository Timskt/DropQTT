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
  channel: string;
  clientId: string;
}

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
  status: 'verifying' | 'transferring' | 'paused' | 'completed' | 'cancelled' | 'failed';
  errorMessage?: string;
  sha256: string;
  savePath?: string;
}

export interface MqttGenericMessage {
  id: string;
  topic: string;
  payload: string;
  payloadLen: number;
  qos: number;
  retain: boolean;
  timestamp: string;
  direction: 'in' | 'out';
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
