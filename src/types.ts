export interface BrokerConfig {
  host: string;
  port: number;
  useTls: boolean;
  clientId: string;
  username?: string;
  password?: string;
  keepAliveSecs: number;
  defaultQos: number;
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

export const BROKER_PRESETS: { name: string; host: string; port: number; useTls: boolean }[] = [
  { name: 'EMQX Public', host: 'broker.emqx.io', port: 1883, useTls: false },
  { name: 'HiveMQ Public', host: 'broker.hivemq.com', port: 1883, useTls: false },
  { name: 'Mosquitto Public', host: 'test.mosquitto.org', port: 1883, useTls: false },
  { name: 'Localhost', host: '127.0.0.1', port: 1883, useTls: false },
];
