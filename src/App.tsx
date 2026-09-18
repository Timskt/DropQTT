import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import confetti from 'canvas-confetti';

import { Sidebar } from './components/Sidebar';
import { BrokerStatusBar } from './components/BrokerStatusBar';
import { BatchSender } from './components/file-transfer/BatchSender';
import { ReceiverConfig } from './components/file-transfer/ReceiverConfig';
import { TransferQueue } from './components/file-transfer/TransferQueue';
import { SubscriptionsBar } from './components/mqttx/SubscriptionsBar';
import { MessageStream } from './components/mqttx/MessageStream';
import { MessagePublisher } from './components/mqttx/MessagePublisher';
import { SettingsModal } from './components/SettingsModal';

import {
  BrokerConfig,
  BrokerProfile,
  ConnectionStatus,
  TransferProgress,
  MqttGenericMessage,
  TopicSubscription,
  BatchFileItem,
} from './types';
import { Language, translations } from './i18n';
import { Theme, themes } from './themes';

export function App() {
  // 1. Workspace mode ('transfer' | 'mqttx')
  const [activeMode, setActiveMode] = useState<'transfer' | 'mqttx'>(() => {
    return (localStorage.getItem('dropqtt_workspace_mode') as 'transfer' | 'mqttx') || 'transfer';
  });

  // 2. Language & Theme
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('dropqtt_lang') as Language) || 'zh-CN';
  });

  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('dropqtt_theme') as Theme) || 'cyberpunk';
  });

  const t = translations[lang] || translations['zh-CN'];
  const currentTheme = themes[theme] || themes.cyberpunk;

  // 3. Broker Configuration & Profiles
  const [config, setConfig] = useState<BrokerConfig>(() => {
    try {
      const saved = localStorage.getItem('dropqtt_active_broker');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return {
      host: 'broker.emqx.io',
      port: 1883,
      useTls: false,
      clientId: `DropQTT_${Math.random().toString(36).substring(2, 8)}`,
      keepAliveSecs: 60,
      defaultQos: 1,
      baseTopic: 'dropqtt',
    };
  });

  const [profiles, setProfiles] = useState<BrokerProfile[]>(() => {
    try {
      const saved = localStorage.getItem('dropqtt_broker_profiles');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [
      {
        id: 'emqx-default',
        name: 'EMQX Public',
        config: {
          host: 'broker.emqx.io',
          port: 1883,
          useTls: false,
          clientId: `DropQTT_${Math.random().toString(36).substring(2, 8)}`,
          keepAliveSecs: 60,
          defaultQos: 1,
          baseTopic: 'dropqtt',
        },
      },
      {
        id: 'local-mosquitto',
        name: 'Localhost (1883)',
        config: {
          host: '127.0.0.1',
          port: 1883,
          useTls: false,
          clientId: `DropQTT_${Math.random().toString(36).substring(2, 8)}`,
          keepAliveSecs: 60,
          defaultQos: 1,
          baseTopic: 'dropqtt',
        },
      },
    ];
  });

  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    brokerHost: config.host,
    brokerPort: config.port,
    channel: 'public-lobby',
    clientId: config.clientId,
  });

  // 4. Topic configuration for File Transfer
  const [publishTopic, setPublishTopic] = useState<string>(() => {
    return localStorage.getItem('dropqtt_publish_topic') || 'dropqtt/public-lobby';
  });

  const [subscribeTopic, setSubscribeTopic] = useState<string>(() => {
    return localStorage.getItem('dropqtt_subscribe_topic') || 'dropqtt/public-lobby/#';
  });

  // 5. File Batch & Transfer state
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [isSendingBatch, setIsSendingBatch] = useState<boolean>(false);
  const [sendingIndex, setSendingIndex] = useState<number>(0);
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  const transfersRef = useRef(transfers);
  transfersRef.current = transfers;

  // 6. Generic MQTT Subscriptions & Message Stream
  const [subscriptions, setSubscriptions] = useState<TopicSubscription[]>(() => {
    try {
      const saved = localStorage.getItem('dropqtt_subscriptions');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [
      { topic: 'dropqtt/#', qos: 1, color: '#06b6d4' },
      { topic: 'test/topic', qos: 0, color: '#10b981' },
    ];
  });

  const [messages, setMessages] = useState<MqttGenericMessage[]>([]);

  // 7. System / UI state
  const [downloadDir, setDownloadDir] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [isTestingLatency, setIsTestingLatency] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  // Persistence helpers
  const handleModeChange = (mode: 'transfer' | 'mqttx') => {
    setActiveMode(mode);
    localStorage.setItem('dropqtt_workspace_mode', mode);
  };

  const handleLangChange = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem('dropqtt_lang', newLang);
  };

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('dropqtt_theme', newTheme);
  };

  const handlePublishTopicChange = (top: string) => {
    setPublishTopic(top);
    localStorage.setItem('dropqtt_publish_topic', top);
  };

  const handleSubscribeTopicChange = (top: string) => {
    setSubscribeTopic(top);
    localStorage.setItem('dropqtt_subscribe_topic', top);
  };

  // 8. Event Listeners (Broker events, file progress, generic MQTT messages)
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenDisconnect: (() => void) | undefined;
    let unlistenMqttMsg: (() => void) | undefined;

    const setupListeners = async () => {
      // Transfer progress
      unlistenProgress = await listen<TransferProgress>('transfer-progress', (event) => {
        const item = event.payload;
        setTransfers((prev) => ({
          ...prev,
          [item.transferId]: item,
        }));

        if (item.status === 'completed' && item.direction === 'receive') {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.8 },
          });
        }
      });

      // Broker status
      unlistenStatus = await listen<ConnectionStatus>('broker-status', (event) => {
        setStatus(event.payload);
      });

      // Broker disconnected
      unlistenDisconnect = await listen<string>('broker-disconnected', () => {
        setStatus((prev) => ({ ...prev, connected: false }));
      });

      // Generic MQTT messages
      unlistenMqttMsg = await listen<MqttGenericMessage>('mqtt-message', (event) => {
        setMessages((prev) => [event.payload, ...prev.slice(0, 499)]);
      });

      // Initial defaults
      try {
        const defaultDir = await invoke<string>('get_default_download_dir');
        setDownloadDir(defaultDir);
        const curStatus = await invoke<ConnectionStatus>('get_connection_status');
        setStatus(curStatus);
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };

    setupListeners();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenStatus) unlistenStatus();
      if (unlistenDisconnect) unlistenDisconnect();
      if (unlistenMqttMsg) unlistenMqttMsg();
    };
  }, []);

  // 9. Broker Connection & Switch
  const handleConnect = async (cfgToConnect: BrokerConfig = config) => {
    setIsConnecting(true);
    try {
      await invoke('connect_broker', { config: cfgToConnect });
      setConfig(cfgToConnect);
      localStorage.setItem('dropqtt_active_broker', JSON.stringify(cfgToConnect));
      setIsSettingsOpen(false);

      // Subscribe to configured receive topic
      if (subscribeTopic) {
        await invoke('subscribe_topic', { topic: subscribeTopic, qos: 1 }).catch(() => {});
      }

      // Re-subscribe all MQTT console custom topics
      for (const sub of subscriptions) {
        await invoke('subscribe_topic', { topic: sub.topic, qos: sub.qos }).catch(() => {});
      }

      // Test latency once connected
      handleTestLatency(cfgToConnect);
    } catch (err: any) {
      console.error('Connection failed:', err);
      alert(`Connection failed: ${err}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke('disconnect_broker');
      setStatus((prev) => ({ ...prev, connected: false }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleConnect = () => {
    if (status.connected) {
      handleDisconnect();
    } else {
      handleConnect(config);
    }
  };

  const handleSelectProfile = (profile: BrokerProfile) => {
    setConfig(profile.config);
    handleConnect(profile.config);
  };

  const handleSaveProfile = (name: string, pConfig: BrokerConfig) => {
    const newProfile: BrokerProfile = {
      id: `prof_${Date.now()}`,
      name,
      config: pConfig,
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    localStorage.setItem('dropqtt_broker_profiles', JSON.stringify(updated));
  };

  const handleDeleteProfile = (id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    setProfiles(updated);
    localStorage.setItem('dropqtt_broker_profiles', JSON.stringify(updated));
  };

  const handleTestLatency = async (cfg: BrokerConfig = config) => {
    setIsTestingLatency(true);
    try {
      const ms = await invoke<number>('test_broker_connection', { config: cfg });
      setLatency(ms);
    } catch (e) {
      console.error('Ping error:', e);
      setLatency(null);
    } finally {
      setIsTestingLatency(false);
    }
  };

  // 10. File Batch Operations & Sequential Sender
  const handleAddBatchFiles = (newFiles: { path: string; name: string; size: number }[]) => {
    const items: BatchFileItem[] = newFiles.map((f) => ({
      id: `batch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      path: f.path,
      name: f.name,
      size: f.size,
      status: 'pending',
    }));
    setBatchFiles((prev) => [...prev, ...items]);
  };

  const handleRemoveBatchFile = (id: string) => {
    setBatchFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleClearBatchFiles = () => {
    setBatchFiles([]);
  };

  const handleStartSendBatch = async (chunkSize: number, qos: number) => {
    if (batchFiles.length === 0 || isSendingBatch) return;

    setIsSendingBatch(true);

    for (let i = 0; i < batchFiles.length; i++) {
      const current = batchFiles[i];
      if (current.status === 'completed') continue;

      setSendingIndex(i);
      setBatchFiles((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: 'sending' } : item))
      );

      try {
        const transferId = await invoke<string>('start_send_file', {
          filePath: current.path,
          chunkSize,
          qos,
          customPublishTopic: publishTopic.trim() || undefined,
        });

        // Wait until this transfer completes, fails, or is cancelled
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const currentTransfer = transfersRef.current[transferId];
            if (currentTransfer) {
              if (
                currentTransfer.status === 'completed' ||
                currentTransfer.status === 'failed' ||
                currentTransfer.status === 'cancelled'
              ) {
                clearInterval(checkInterval);
                resolve();
              }
            }
          }, 300);
        });

        const finalStatus = transfersRef.current[transferId]?.status;
        setBatchFiles((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: finalStatus === 'completed' ? 'completed' : 'failed',
                  transferId,
                }
              : item
          )
        );
      } catch (err: any) {
        console.error(`Failed to send file ${current.name}:`, err);
        setBatchFiles((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'failed', error: String(err) } : item
          )
        );
      }
    }

    setIsSendingBatch(false);
    confetti({
      particleCount: 80,
      spread: 80,
      origin: { y: 0.7 },
    });
  };

  // 11. Receiver topic apply & Download folder
  const handleApplySubscribeTopic = async (top: string) => {
    handleSubscribeTopicChange(top);
    if (status.connected) {
      await invoke('subscribe_topic', { topic: top.trim(), qos: 1 });
    }
  };

  const handleChangeDownloadDir = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        await invoke('set_download_dir', { path: selected });
        setDownloadDir(selected);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 12. Transfer controls (Pause/Resume/Cancel/Reveal)
  const handlePause = async (id: string) => {
    await invoke('pause_transfer', { transferId: id });
  };

  const handleResume = async (id: string) => {
    await invoke('resume_transfer', { transferId: id });
  };

  const handleCancel = async (id: string) => {
    await invoke('cancel_transfer', { transferId: id });
  };

  const handleReveal = async (path: string) => {
    await invoke('reveal_file', { filePath: path });
  };

  // 13. MQTTX Client topic subscriptions & message publishing
  const handleAddSubscription = async (topic: string, qos: number, color?: string) => {
    if (subscriptions.some((s) => s.topic === topic)) return;
    const newSub: TopicSubscription = {
      topic,
      qos,
      color,
      createdAt: new Date().toLocaleTimeString(),
    };
    const updated = [...subscriptions, newSub];
    setSubscriptions(updated);
    localStorage.setItem('dropqtt_subscriptions', JSON.stringify(updated));

    if (status.connected) {
      await invoke('subscribe_topic', { topic, qos }).catch((e) => {
        console.error('Subscribe error:', e);
      });
    }
  };

  const handleRemoveSubscription = async (topic: string) => {
    const updated = subscriptions.filter((s) => s.topic !== topic);
    setSubscriptions(updated);
    localStorage.setItem('dropqtt_subscriptions', JSON.stringify(updated));

    if (status.connected) {
      await invoke('unsubscribe_topic', { topic }).catch((e) => {
        console.error('Unsubscribe error:', e);
      });
    }
  };

  const handlePublishMessage = async (
    topic: string,
    payload: string,
    qos: number,
    retain: boolean
  ) => {
    await invoke('publish_message', { topic, payload, qos, retain });
  };

  const handleClearMessages = () => {
    setMessages([]);
  };

  // 14. Auto updater
  const handleCheckUpdate = async () => {
    setUpdateStatusText(t.checkingUpdate);
    try {
      const update = await check();
      if (update && update.available) {
        setUpdateStatusText(`${t.newVersionAvailable} (${update.version})`);
        if (confirm(`${t.newVersionAvailable} (v${update.version})\n${t.updateNow}?`)) {
          await update.downloadAndInstall();
        }
      } else {
        setUpdateStatusText(t.upToDate);
      }
    } catch (err) {
      console.error(err);
      setUpdateStatusText(t.upToDate);
    }
    setTimeout(() => setUpdateStatusText(null), 4000);
  };

  const activeTransfersCount = Object.values(transfers).filter(
    (t) => t.status === 'transferring' || t.status === 'verifying'
  ).length;

  return (
    <div
      className="min-h-screen flex overflow-hidden font-sans select-none"
      style={{
        background: currentTheme.bodyBg,
        color: currentTheme.textPrimary,
      }}
    >
      {/* 1. Left Vertical Dock Navigation */}
      <Sidebar
        activeMode={activeMode}
        setActiveMode={handleModeChange}
        activeTransfersCount={activeTransfersCount}
        activeSubsCount={subscriptions.length}
        connected={status.connected}
        brokerHost={status.brokerHost}
        brokerPort={status.brokerPort}
        latency={latency}
        channel={status.channel}
        onOpenSettings={() => setIsSettingsOpen(true)}
        lang={lang}
        setLang={handleLangChange}
        theme={theme}
        setTheme={handleThemeChange}
        t={t}
      />

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Status Bar */}
        <BrokerStatusBar
          activeMode={activeMode}
          connected={status.connected}
          config={config}
          profiles={profiles}
          onSelectProfile={handleSelectProfile}
          latency={latency}
          isTesting={isTestingLatency}
          onTestLatency={() => handleTestLatency(config)}
          onToggleConnect={handleToggleConnect}
          isConnecting={isConnecting}
          t={t}
        />

        {/* Scrollable Main Workspace Content */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeMode === 'transfer' ? (
            /* Mode 1: File Transfer Hub */
            <div className="space-y-4 max-w-5xl mx-auto">
              {/* Top Configuration Grid: Batch Sender (Left) & Receiver (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BatchSender
                  publishTopic={publishTopic}
                  setPublishTopic={handlePublishTopicChange}
                  files={batchFiles}
                  onAddFiles={handleAddBatchFiles}
                  onRemoveFile={handleRemoveBatchFile}
                  onClearFiles={handleClearBatchFiles}
                  onStartSendBatch={handleStartSendBatch}
                  isSending={isSendingBatch}
                  sendingIndex={sendingIndex}
                  connected={status.connected}
                  t={t}
                />

                <ReceiverConfig
                  subscribeTopic={subscribeTopic}
                  setSubscribeTopic={handleSubscribeTopicChange}
                  onApplySubscribeTopic={handleApplySubscribeTopic}
                  downloadDir={downloadDir}
                  onSelectDownloadDir={handleChangeDownloadDir}
                  connected={status.connected}
                  t={t}
                />
              </div>

              {/* Full Width Transfer Queue */}
              <TransferQueue
                transfers={transfers}
                onPause={handlePause}
                onResume={handleResume}
                onCancel={handleCancel}
                onReveal={handleReveal}
                t={t}
              />
            </div>
          ) : (
            /* Mode 2: Generic MQTTX Client Console */
            <div className="space-y-4 max-w-5xl mx-auto">
              {/* Subscriptions Bar */}
              <SubscriptionsBar
                subscriptions={subscriptions}
                onAddSubscription={handleAddSubscription}
                onRemoveSubscription={handleRemoveSubscription}
                connected={status.connected}
                t={t}
              />

              {/* Live Message Monitor Feed */}
              <MessageStream
                messages={messages}
                onClearMessages={handleClearMessages}
                t={t}
              />

              {/* Message Publisher */}
              <MessagePublisher
                onPublishMessage={handlePublishMessage}
                connected={status.connected}
                t={t}
              />
            </div>
          )}
        </main>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSaveAndConnect={(cfg) => handleConnect(cfg)}
        onDisconnect={handleDisconnect}
        isConnected={status.connected}
        lang={lang}
        onLangChange={handleLangChange}
        theme={theme}
        onThemeChange={handleThemeChange}
        t={t}
        onCheckUpdate={handleCheckUpdate}
        updateStatusText={updateStatusText}
        profiles={profiles}
        onSaveProfile={handleSaveProfile}
        onDeleteProfile={handleDeleteProfile}
      />
    </div>
  );
}

export default App;
