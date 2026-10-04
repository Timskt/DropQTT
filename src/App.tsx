import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { toast } from './utils/toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MessageStream } from './components/mqttx/MessageStream';
import { MessagePublisher } from './components/mqttx/MessagePublisher';
import { useBrokerCapabilities } from './hooks/useBrokerCapabilities';
import { TopicTrafficPanel } from './components/mqttx/TopicTrafficPanel';
import { BrokerSysPanel } from './components/mqttx/BrokerSysPanel';
import { BridgePanel } from './components/bridge/BridgePanel';
import { HistoryPanel } from './components/history/HistoryPanel';
import { SettingsModal } from './components/SettingsModal';
import { ToastHost } from './components/ToastHost';
import { OpsPanel } from './components/ops/OpsPanel';

import { BrokerConfig, MqttGenericMessage } from './types';
import { traceTokenFor } from './utils/history';
import { LANGUAGES, Language, Translations, fill, translations } from './i18n';
import { applyTheme, THEMES, Theme } from './themes';
import { usePersistentString } from './hooks/usePersistentState';
import { useBroker } from './hooks/useBroker';
import { useBridge } from './hooks/useBridge';
import { useMqttMessages } from './hooks/useMqttMessages';
import { useSubscriptionStats } from './hooks/useSubscriptionStats';
import { useTopicStats } from './hooks/useTopicStats';
import { useBrokerSys } from './hooks/useBrokerSys';
import { useHistoryCount } from './hooks/useHistoryCount';
import { useTransfers } from './hooks/useTransfers';
import { useBatchSender } from './hooks/useBatchSender';
import { useRpc } from './hooks/useRpc';
import { useAssertions } from './hooks/useAssertions';
import { useFaults } from './hooks/useFaults';
import { useResponder } from './hooks/useResponder';
import { RpcPanel } from './components/mqttx/RpcPanel';
import { ReplayPanel } from './components/mqttx/ReplayPanel';
import { AssertionPanel } from './components/mqttx/AssertionPanel';
import { FaultPanel } from './components/mqttx/FaultPanel';
import { ResponderPanel } from './components/mqttx/ResponderPanel';
import { CommandPalette, PaletteCommand } from './components/CommandPalette';

const MODE_TITLES: Record<WorkspaceMode, (t: Translations) => string> = {
  transfer: (t) => t.modeFileTransfer,
  mqttx: (t) => t.modeMqttClient,
  bridge: (t) => t.modeBridge,
  history: (t) => t.modeHistory,
  ops: (t) => t.modeOps,
};

export function App() {
  // ---- Workspace preferences (raw-string localStorage keys, back-compat) ----
  const [modeStr, setModeStr] = usePersistentString('dropqtt_workspace_mode', 'transfer');
  const activeMode: WorkspaceMode =
    modeStr === 'mqttx' || modeStr === 'bridge' || modeStr === 'history' || modeStr === 'ops'
      ? modeStr
      : 'transfer';

  const [langStr, setLangStr] = usePersistentString('dropqtt_lang', 'zh-CN');
  const lang = langStr as Language;

  const [themeStr, setThemeStr] = usePersistentString('dropqtt_theme', 'cyberpunk');
  const theme = themeStr as Theme;

  // Row spacing, and the palette that opens with Ctrl/Cmd+K. The palette exists for
  // discoverability, so its own entry point has to be visible too.
  const [density, setDensity] = usePersistentString('dropqtt_density', 'cozy');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const t = translations[lang] || translations['zh-CN'];

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Density is a view preference like the theme: one attribute on the root, and CSS
  // tightens every row without a re-render of the feed.
  useEffect(() => {
    document.documentElement.dataset.density = density === 'compact' ? 'compact' : 'cozy';
  }, [density]);

  // ---- File-transfer topic configuration ----
  const [publishTopic, setPublishTopic] = usePersistentString('dropqtt_publish_topic', 'dropqtt/public-lobby');
  const [subscribeTopic, setSubscribeTopic] = usePersistentString('dropqtt_subscribe_topic', 'dropqtt/public-lobby/#');

  // ---- Core state hooks ----
  // Break the broker <-> messages dependency cycle: broker needs the topic
  // registry at connect time, messages need the connection flag.
  const getConsoleTopicsRef = useRef<() => { topic: string; qos: number }[]>(() => []);
  const subscribeTopicRef = useRef(subscribeTopic);
  useEffect(() => { subscribeTopicRef.current = subscribeTopic; }, [subscribeTopic]);

  const broker = useBroker({
    getTopicsToRegister: () => [
      ...(subscribeTopicRef.current.trim() ? [{ topic: subscribeTopicRef.current.trim(), qos: 1 }] : []),
      ...getConsoleTopicsRef.current(),
    ],
  });

  const mqtt = useMqttMessages(broker.isConnected);
  useEffect(() => { getConsoleTopicsRef.current = mqtt.getTopicsToRegister; }, [mqtt.getTopicsToRegister]);

  // Persisted-history row count → drives the sidebar "报文历史" badge
  const historyCount = useHistoryCount(broker.isConnected);

  // Bridge (broker-to-broker forwarding) — events keep accumulating across tabs
  const bridge = useBridge(activeMode === 'bridge');
  const bridgeOptions = [
    { id: 'session', name: t.currentConfig, config: broker.config },
    ...broker.profiles,
  ];

  // Subscription hit stats: polled only while the console is open and connected
  const subStats = useSubscriptionStats(broker.isConnected && activeMode === 'mqttx');

  // Live per-topic traffic ranking (hot-topic finder)
  const topicStats = useTopicStats(activeMode === 'mqttx');

  // Broker $SYS health metrics (console + connected only)
  const brokerSys = useBrokerSys(broker.isConnected && activeMode === 'mqttx');
  // The broker's own account of its limits, read from the CONNACK.
  const brokerCaps = useBrokerCapabilities(broker.isConnected);

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

  // ---- Feed row workbench ----
  // A row is where "what was this answering?" arises, so the moves live there:
  // follow its correlation in the history trace, filter the feed to its topic,
  // republish its bytes as a request, or copy the equivalent CLI command.
  const [traceRequest, setTraceRequest] = useState<string | null>(null);
  // One object per connected broker: the row memo compares it by identity, so
  // rebuilding it on every render would re-render the whole feed.
  const brokerTarget = useMemo(
    () => ({ host: broker.config.host, port: broker.config.port, tls: !!broker.config.useTls }),
    [broker.config.host, broker.config.port, broker.config.useTls],
  );

  const handleTraceFromRow = useCallback((m: MqttGenericMessage) => {
    setTraceRequest(traceTokenFor(m));
    setModeStr('history');
  }, [setModeStr]);

  const handleSendRowAsRpc = useCallback(async (m: MqttGenericMessage) => {
    // A new identity, deliberately: replaying a request with the *old* correlation
    // would pair this answer with whoever asked first.
    const correlation = `dq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await invoke('rpc_request', {
      spec: {
        topic: m.topic,
        payloadBase64: m.payloadBase64,
        qos: m.qos,
        retain: false,
        timeoutMs: 5000,
        attempts: 1,
        responseTopic: m.responseTopic?.trim() || `${m.topic}/reply`,
        correlationData: correlation,
        contentType: m.contentType ?? undefined,
        userProperties: m.userProperties ?? [],
      },
    });
    toast.success(t.rpcSendDone);
  }, [t.rpcSendDone]);

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
      // A connect that fails silently is indistinguishable from one that never
      // was asked for; the status dot says "disconnected" either way.
      toast.error(`${t.connectFailed}: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const handleApplySubscribeTopic = async (top: string) => {
    setSubscribeTopic(top);
    if (broker.isConnected) {
      await broker.registerTopic(top.trim(), 1).catch((e) => {
        toast.error(`${fill(t.subscribeFailed, { topic: top.trim() })}: ${e}`);
      });
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
      // "Already up to date" is a claim about the release channel, and a failed
      // request says nothing of the kind. Say what actually happened.
      console.error(err);
      setUpdateStatusText(t.updateCheckFailed);
      toast.error(`${t.updateCheckFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setUpdateStatusText(null), 4000);
  };

  const isV5 = (broker.config.protocolVersion ?? 3) === 5;

  // Request/response calls live in Rust; the console lists them while it is open
  const rpc = useRpc(activeMode === 'mqttx', broker.isConnected);

  // Rules stay armed in Rust when the console closes; only the tallies stop polling
  const assertions = useAssertions(activeMode === 'mqttx');
  const faults = useFaults(activeMode === 'mqttx');
  const responder = useResponder(activeMode === 'mqttx');

  // Ctrl/Cmd+K opens the palette from anywhere, including while a panel has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Switch workspace, then land on the control a person would press next. The
   *  delay is one paint: the target panel does not exist until the mode renders. */
  const focusInMode = (mode: WorkspaceMode, selector: string, activate = false) => {
    setModeStr(mode);
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      if (activate) el.click();
      else (el as HTMLInputElement).focus?.();
    }, 80);
  };
  const focusInConsole = (selector: string) => focusInMode('mqttx', selector);

  const paletteCommands: PaletteCommand[] = [
    { id: 'go-transfer', group: t.paletteGroupWorkspace, label: t.modeFileTransfer, run: () => setModeStr('transfer') },
    { id: 'go-mqttx', group: t.paletteGroupWorkspace, label: t.modeMqttClient, run: () => setModeStr('mqttx') },
    { id: 'go-bridge', group: t.paletteGroupWorkspace, label: t.modeBridge, run: () => setModeStr('bridge') },
    { id: 'go-history', group: t.paletteGroupWorkspace, label: t.modeHistory, run: () => setModeStr('history') },
    { id: 'go-ops', group: t.paletteGroupWorkspace, label: t.modeOps, run: () => setModeStr('ops') },
    {
      id: 'toggle-connect',
      group: t.paletteGroupConnection,
      label: broker.isConnected ? t.paletteDisconnect : t.paletteConnect,
      hint: `${broker.config.host}:${broker.config.port}`,
      run: () => void broker.toggleConnect(),
    },
    { id: 'settings', group: t.paletteGroupConnection, label: t.paletteSettings, run: () => setIsSettingsOpen(true) },
    {
      id: 'pause-feed',
      group: t.paletteGroupConsole,
      label: mqtt.paused ? t.paletteResumeFeed : t.palettePauseFeed,
      hint: `${mqtt.messages.length}`,
      run: () => mqtt.togglePaused(),
    },
        {
      id: 'bench',
      group: t.paletteGroupConsole,
      label: t.paletteOpenBench,
      // The bench lab lives inside the traffic panel, so this is the two keystrokes
      // a person would make by hand: go to the console, then press the control.
      run: () => {
        setModeStr('mqttx');
        window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-testid=bench-toggle]')?.click(), 60);
      },
    },
    {
      id: 'theme',
      group: t.paletteGroupView,
      label: t.paletteTheme,
      hint: theme,
      run: () => setThemeStr(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]),
    },
    {
      id: 'language',
      group: t.paletteGroupView,
      label: t.paletteLanguage,
      hint: lang,
      run: () => setLangStr(LANGUAGES[(LANGUAGES.indexOf(lang) + 1) % LANGUAGES.length]),
    },
    {
      id: 'density',
      group: t.paletteGroupView,
      label: density === 'compact' ? t.paletteDensityCozy : t.paletteDensityCompact,
      run: () => setDensity(density === 'compact' ? 'cozy' : 'compact'),
    },
    // The capabilities the review called undiscoverable — shared subscriptions, RPC,
    // tracing, replay — are real and complete, and hidden inside collapsed panels.
    // Each of these is the two keystrokes a person would make by hand.
    {
      id: 'subscribe',
      group: t.paletteGroupFeatures,
      label: t.paletteSubscribe,
      hint: String(mqtt.subscriptions.length),
      run: () => focusInConsole('[data-testid=sub-topic-input]'),
    },
    {
      id: 'responder',
      group: t.paletteGroupFeatures,
      label: t.paletteResponder,
      run: () => focusInConsole('[data-testid=responder-add]'),
    },
    {
      id: 'replay',
      group: t.paletteGroupFeatures,
      label: t.paletteReplay,
      run: () => focusInConsole('[data-testid=replay-load]'),
    },
    {
      id: 'trace',
      group: t.paletteGroupFeatures,
      label: t.paletteTrace,
      run: () => focusInMode('history', '[data-testid=trace-token]'),
    },
    {
      id: 'timeline',
      group: t.paletteGroupFeatures,
      label: t.paletteTimeline,
      run: () => focusInMode('history', '[data-testid=timeline-build]', true),
    },
    ...broker.profiles.map((p) => ({
      id: `profile-${p.id}`,
      group: t.paletteGroupProfiles,
      label: p.name,
      hint: `${p.config.host}:${p.config.port}`,
      run: () => broker.selectProfile(p),
    })),
  ];

  return (
    <div className="min-h-screen flex overflow-hidden font-sans">
      <a href="#main-content" className="skip-link select-none">{t.skipToContent}</a>
      {/* 1. Left Vertical Dock Navigation */}
      <Sidebar
        activeMode={activeMode}
        setActiveMode={setModeStr}
        activeTransfersCount={transferState.activeCount}
        awaitingApprovalCount={transferState.awaitingApproval.length}
        activeSubsCount={mqtt.subscriptions.length}
        activeBridgeRulesCount={bridge.rules.filter((r) => r.enabled).length}
        historyCount={historyCount}
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
          onOpenPalette={() => setPaletteOpen(true)}
          t={t}
        />

        {/* Connection error banner (backend events) */}
        {broker.connectionError && !broker.isConnecting && (
          <div
            className="px-4 py-1.5 flex items-center gap-2 text-[11px] font-mono"
            style={{ background: 'var(--bad-soft)', borderBottom: '1px solid var(--bad-border)', color: 'var(--bad)' }}
          >
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate flex-1">{broker.connectionError}</span>
            <button
              onClick={() => broker.toggleConnect()}
              className="px-2 py-0.5 rounded border font-semibold shrink-0"
              style={{ borderColor: 'var(--bad-border)' }}
            >
              {t.connect}
            </button>
          </div>
        )}

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 space-y-4 outline-none">
          {/* Keyed by mode so switching workspaces clears a prior failure. */}
          <ErrorBoundary area={MODE_TITLES[activeMode](t)} t={t}>
          {activeMode === 'ops' ? (
            <OpsPanel
              t={t}
              caps={brokerCaps}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenConsole={() => setModeStr('mqttx')}
              onOpenHistory={() => setModeStr('history')}
              onToggleConnect={broker.toggleConnect}
              isConnecting={broker.isConnecting}
              onTestLatency={() => broker.testLatency(broker.config)}
              isTestingLatency={broker.isTestingLatency}
            />
          ) : activeMode === 'history' ? (
            /* Mode 4: Persistent message history */
            <HistoryPanel
              t={t}
              connected={broker.isConnected}
              requestTrace={traceRequest}
              brokerLabel={`${broker.config.host}:${broker.config.port}`}
              onPublish={(params) => mqtt.publish(params)}
              onSubscribe={(topic) => {
                mqtt.addSubscription(topic, 1).catch((e) => {
                  toast.error(`${fill(t.subscribeFailed, { topic })}: ${e}`);
                });
              }}
            />
          ) : activeMode === 'bridge' ? (
            /* Mode 3: Broker-to-Broker Data Bridge */
            <BridgePanel options={bridgeOptions} bridge={bridge} onOpenSettings={() => setIsSettingsOpen(true)} connected={broker.isConnected} t={t} />
          ) : activeMode === 'transfer' ? (
            /* Mode 1: File Transfer Hub */
            <div className="space-y-4 max-w-6xl mx-auto">
              <div className="workspace-two-col">
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
                onResend={(item) => void transferState.resendTransfer(item)}
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
                subIds={subStats.ids}
                ack={subStats.ack}
                caps={brokerCaps}
                onResetStats={subStats.resetStats}
                connected={broker.isConnected}
                isV5={isV5}
                t={t}
              />

              <BrokerSysPanel
                rows={brokerSys.rows}
                connected={broker.isConnected}
                onClear={brokerSys.clear}
                t={t}
              />

              <TopicTrafficPanel
                rows={topicStats.rows}
                series={topicStats.series}
                onReset={topicStats.resetTopicStats}
                connected={broker.isConnected}
                cap={topicStats.cap}
                setCap={topicStats.setCap}
                t={t}
              />

              <MessageStream
                messages={mqtt.messages}
                onClearMessages={mqtt.clearMessages}
                onClearRetained={handleClearRetained}
                connected={broker.isConnected}
                onReplay={(m) =>
                  mqtt.publish({
                    topic: m.topic,
                    payloadBase64: m.payloadBase64,
                    qos: m.qos,
                    retain: m.retain,
                    properties: {
                      contentType: m.contentType,
                      userProperties: m.userProperties ?? [],
                      // Without these an MQTT5 RPC replay loses its reply
                      // address and the responder's correlation never matches.
                      responseTopic: m.responseTopic,
                      correlationData: m.correlationData,
                      // The lossless form travels with it, so replaying a stored
                      // binary correlation does not turn it into replacement chars.
                      correlationHex: m.correlationHex,
                    },
                  })
                }
                onQuickSubscribe={(topic) => {
                  mqtt.addSubscription(topic, 1).catch((e) => {
                    toast.error(`${fill(t.subscribeFailed, { topic })}: ${e}`);
                  });
                }}
                paused={mqtt.paused}
                broker={brokerTarget}
                onTrace={handleTraceFromRow}
                onSendAsRpc={handleSendRowAsRpc}
                pendingCount={mqtt.pendingCount}
                feedDropped={mqtt.feedDropped}
                onTogglePaused={mqtt.togglePaused}
                t={t}
              />

              <AssertionPanel
                rules={assertions.rules}
                stats={assertions.stats}
                armed={assertions.armed}
                recent={assertions.recent}
                lastError={assertions.lastError}
                onAdd={assertions.addRule}
                onRemove={assertions.removeRule}
                onToggle={assertions.toggleRule}
                onReset={assertions.reset}
                t={t}
              />

              <FaultPanel
                rules={faults.rules}
                stats={faults.stats}
                lastError={faults.lastError}
                onAdd={faults.addRule}
                onUpdate={faults.updateRule}
                onRemove={faults.removeRule}
                onToggle={faults.toggleRule}
                onReset={faults.reset}
                t={t}
              />

              <ResponderPanel
                rules={responder.rules}
                stats={responder.stats}
                lastError={responder.lastError}
                connected={broker.isConnected}
                onAdd={responder.addRule}
                onUpdate={responder.updateRule}
                onRemove={responder.removeRule}
                onToggle={responder.toggleRule}
                onReset={responder.reset}
                t={t}
              />

              <MessagePublisher
                onPublishMessage={mqtt.publish}
                onRpcRequest={isV5 && broker.isConnected ? rpc.request : undefined}
                connected={broker.isConnected}
                isV5={isV5}
                caps={brokerCaps}
                t={t}
              />

              {isV5 && <RpcPanel calls={rpc.calls} onClearFinished={rpc.clearFinished} t={t} />}

              {/* Replay is offered in both protocol versions; the panel itself says
                  which fields a 3.1.1 session cannot carry. */}
              <ReplayPanel t={t} connected={broker.isConnected} isV5={isV5} onPublish={mqtt.publish} />

              {/* Console-side error surface for failed publishes */}
              {broker.connectionError && (
                <div className="flex items-center gap-2 text-[11px] font-mono px-1" style={{ color: 'var(--bad)' }}>
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{broker.connectionError}</span>
                </div>
              )}
            </div>
          )}
        </ErrorBoundary>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        t={t}
      />

      {/* Global toast surface */}
      <ToastHost />

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
