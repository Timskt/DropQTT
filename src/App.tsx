import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { open } from '@tauri-apps/plugin-dialog';
import { AlertCircle, WifiOff } from 'lucide-react';

import { Sidebar, WorkspaceMode } from './components/Sidebar';
import { BrokerStatusBar } from './components/BrokerStatusBar';
import { BatchSender } from './components/file-transfer/BatchSender';
import { ReceiverConfig } from './components/file-transfer/ReceiverConfig';
import { TransferQueue } from './components/file-transfer/TransferQueue';
import { SubscriptionsBar } from './components/mqttx/SubscriptionsBar';
import { MessageStream } from './components/mqttx/MessageStream';
import { MessagePublisher } from './components/mqttx/MessagePublisher';
import { BridgePanel } from './components/bridge/BridgePanel';
import { SettingsModal } from './components/SettingsModal';

import { BrokerConfig } from './types';
import { Language, translations } from './i18n';
import { applyTheme, Theme } from './themes';
import { usePersistentString } from './hooks/usePersistentState';
import { useBroker } from './hooks/useBroker';
import { useBridge } from './hooks/useBridge';
import { useMqttMessages } from './hooks/useMqttMessages';
import { useSubscriptionStats } from './hooks/useSubscriptionStats';
import { useTransfers } from './hooks/useTransfers';
import { useBatchSender } from './hooks/useBatchSender';

export function App() {
  // ---- Workspace preferences (raw-string localStorage keys, back-compat) ----
  const [modeStr, setModeStr] = usePersistentString('dropqtt_workspace_mode', 'transfer');
  const activeMode: WorkspaceMode =
    modeStr === 'mqttx' || modeStr === 'bridge' ? modeStr : 'transfer';

  const [langStr, setLangStr] = usePersistentString('dropqtt_lang', 'zh-CN');
  const lang = langStr as Language;

  const [themeStr, setThemeStr] = usePersistentString('dropqtt_theme', 'cyberpunk');
  const theme = themeStr as Theme;

  const t = translations[lang] || translations['zh-CN'];

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // ---- File-transfer topic configuration ----
  const [publishTopic, setPublishTopic] = usePersistentString('dropqtt_publish_topic', 'dropqtt/public-lobby');
  const [subscribeTopic, setSubscribeTopic] = usePersistentString('dropqtt_subscribe_topic', 'dropqtt/public-lobby/#');

  // ---- Core state hooks ----
  // Break the broker <-> messages dependency cycle: broker needs the topic
  // registry at connect time, messages need the connection flag.
  const getConsoleTopicsRef = useRef<() => { topic: string; qos: number }[]>(() => []);
  const subscribeTopicRef = useRef(subscribeTopic);
  subscribeTopicRef.current = subscribeTopic;

  const broker = useBroker({
    getTopicsToRegister: () => [
      ...(subscribeTopicRef.current.trim() ? [{ topic: subscribeTopicRef.current.trim(), qos: 1 }] : []),
      ...getConsoleTopicsRef.current(),
    ],
  });

  const mqtt = useMqttMessages(broker.isConnected);
  getConsoleTopicsRef.current = mqtt.getTopicsToRegister;

  // Bridge (broker-to-broker forwarding) — events keep accumulating across tabs
  const bridge = useBridge(activeMode === 'bridge');
  const bridgeOptions = [
    { id: 'session', name: t.currentConfig, config: broker.config },
    ...broker.profiles,
  ];

  // Subscription hit stats: polled only while the console is open and connected
  const subStats = useSubscriptionStats(broker.isConnected && activeMode === 'mqttx');

  const handleClearRetained = async (topics: string[]) => {
    for (const topic of topics) {
      await mqtt.publish({
        topic,
        payloadBase64: '',
        qos: 0,
        retain: true,
        properties: { userProperties: [] },
      });
    }
  };

  const transferState = useTransfers();
  const batch = useBatchSender({
    publishTopic,
    waitForSendComplete: transferState.waitForSendComplete,
  });

  // ---- UI / system state ----
  const [downloadDir, setDownloadDir] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>('get_default_download_dir')
      .then(setDownloadDir)
      .catch((e) => console.error('Download dir init error:', e));
  }, []);

  // ---- Connections & topics wiring ----
  const handleConnect = (cfg: BrokerConfig) => {
    broker.connect(cfg).catch((err) => {
      console.error('Connection failed:', err);
    });
  };

  const handleApplySubscribeTopic = async (top: string) => {
    setSubscribeTopic(top);
    if (broker.isConnected) {
      await broker.registerTopic(top.trim(), 1).catch((e) => console.error('registerTopic:', e));
    }
  };

  const handleChangeDownloadDir = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        await invoke('set_download_dir', { path: selected });
        setDownloadDir(selected);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ---- Auto updater ----
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

  const isV5 = (broker.config.protocolVersion ?? 3) === 5;

  return (
    <div className="min-h-screen flex overflow-hidden font-sans select-none">
      {/* 1. Left Vertical Dock Navigation */}
      <Sidebar
        activeMode={activeMode}
        setActiveMode={setModeStr}
        activeTransfersCount={transferState.activeCount}
        awaitingApprovalCount={transferState.awaitingApproval.length}
        activeSubsCount={mqtt.subscriptions.length}
        activeBridgeRulesCount={bridge.rules.filter((r) => r.enabled).length}
        connected={broker.isConnected}
        brokerHost={broker.status.brokerHost}
        brokerPort={broker.status.brokerPort}
        protocolVersion={broker.config.protocolVersion ?? 3}
        latency={broker.latency}
        onOpenSettings={() => setIsSettingsOpen(true)}
        lang={lang}
        setLang={setLangStr}
        theme={theme}
        setTheme={setThemeStr}
        t={t}
      />

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <BrokerStatusBar
          activeMode={activeMode}
          connected={broker.isConnected}
          config={broker.config}
          profiles={broker.profiles}
          onSelectProfile={broker.selectProfile}
          latency={broker.latency}
          isTesting={broker.isTestingLatency}
          onTestLatency={() => broker.testLatency(broker.config)}
          onToggleConnect={broker.toggleConnect}
          isConnecting={broker.isConnecting}
          t={t}
        />

        {/* Connection error banner (backend events) */}
        {broker.connectionError && !broker.isConnecting && (
          <div className="px-4 py-1.5 bg-rose-950/60 border-b border-rose-900/60 flex items-center gap-2 text-[11px] text-rose-300 font-mono">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate flex-1">{broker.connectionError}</span>
            <button
              onClick={() => broker.toggleConnect()}
              className="px-2 py-0.5 rounded border border-rose-700 hover:bg-rose-900/50 font-semibold shrink-0"
            >
              {t.connect}
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeMode === 'bridge' ? (
            /* Mode 3: Broker-to-Broker Data Bridge */
            <BridgePanel options={bridgeOptions} bridge={bridge} t={t} />
          ) : activeMode === 'transfer' ? (
            /* Mode 1: File Transfer Hub */
            <div className="space-y-4 max-w-5xl mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BatchSender
                  publishTopic={publishTopic}
                  setPublishTopic={setPublishTopic}
                  files={batch.batchFiles}
                  onAddFiles={batch.addBatchFiles}
                  onRemoveFile={batch.removeBatchFile}
                  onClearFiles={batch.clearBatchFiles}
                  onStartSendBatch={batch.startSendBatch}
                  onCancelBatch={batch.requestBatchCancel}
                  isSending={batch.isSendingBatch}
                  sendingIndex={batch.sendingIndex}
                  connected={broker.isConnected}
                  t={t}
                />

                <ReceiverConfig
                  subscribeTopic={subscribeTopic}
                  setSubscribeTopic={setSubscribeTopic}
                  onApplySubscribeTopic={handleApplySubscribeTopic}
                  downloadDir={downloadDir}
                  onSelectDownloadDir={handleChangeDownloadDir}
                  connected={broker.isConnected}
                  autoReceive={transferState.autoReceive}
                  onToggleAutoReceive={transferState.setAutoReceive}
                  t={t}
                />
              </div>

              <TransferQueue
                transfers={transferState.transfers}
                onPause={transferState.pauseTransfer}
                onResume={transferState.resumeTransfer}
                onCancel={transferState.cancelTransfer}
                onReveal={transferState.revealFile}
                onApprove={transferState.approveTransfer}
                onReject={transferState.rejectTransfer}
                onClearFinished={transferState.clearFinished}
                t={t}
              />
            </div>
          ) : (
            /* Mode 2: Generic MQTTX Client Console */
            <div className="space-y-4 max-w-6xl mx-auto flex flex-col">
              <SubscriptionsBar
                subscriptions={mqtt.subscriptions}
                onAddSubscription={mqtt.addSubscription}
                onRemoveSubscription={mqtt.removeSubscription}
                hitStats={subStats.stats}
                onResetStats={subStats.resetStats}
                connected={broker.isConnected}
                t={t}
              />

              <MessageStream
                messages={mqtt.messages}
                onClearMessages={mqtt.clearMessages}
                onClearRetained={handleClearRetained}
                paused={mqtt.paused}
                pendingCount={mqtt.pendingCount}
                onTogglePaused={mqtt.togglePaused}
                t={t}
              />

              <MessagePublisher
                onPublishMessage={mqtt.publish}
                connected={broker.isConnected}
                isV5={isV5}
                t={t}
              />

              {/* Console-side error surface for failed publishes */}
              {broker.connectionError && (
                <div className="flex items-center gap-2 text-[11px] text-rose-400 font-mono px-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{broker.connectionError}</span>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={broker.config}
        onSaveAndConnect={handleConnect}
        onDisconnect={broker.disconnect}
        isConnected={broker.isConnected}
        lang={lang}
        onLangChange={setLangStr}
        theme={theme}
        onThemeChange={setThemeStr}
        t={t}
        onCheckUpdate={handleCheckUpdate}
        updateStatusText={updateStatusText}
        profiles={broker.profiles}
        onSaveProfile={broker.saveProfile}
        onDeleteProfile={broker.deleteProfile}
      />
    </div>
  );
}

export default App;
