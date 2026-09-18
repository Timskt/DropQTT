import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import confetti from 'canvas-confetti';
import { Navbar } from './components/Navbar';
import { BrokerCard } from './components/BrokerCard';
import { SendCard } from './components/SendCard';
import { ReceiveCard } from './components/ReceiveCard';
import { TransferItem } from './components/TransferItem';
import { SettingsModal } from './components/SettingsModal';
import { BrokerConfig, BrokerProfile, ConnectionStatus, TransferProgress } from './types';
import { Language, translations } from './i18n';
import { Theme, themes } from './themes';
import { Activity, Inbox, Send, Layers } from 'lucide-react';

export function App() {
  // 1. Language & Theme state (persisted)
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('dropqtt_lang') as Language) || 'zh-CN';
  });

  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('dropqtt_theme') as Theme) || 'cyberpunk';
  });

  const t = translations[lang] || translations['zh-CN'];
  const currentTheme = themes[theme] || themes.cyberpunk;

  // 2. Broker Connection State & Profiles (persisted)
  const [config, setConfig] = useState<BrokerConfig>(() => {
    try {
      const saved = localStorage.getItem('dropqtt_active_broker');
      if (saved) {
        return JSON.parse(saved);
      }
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
      if (saved) {
        return JSON.parse(saved);
      }
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

  const [downloadDir, setDownloadDir] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  const [filterTab, setFilterTab] = useState<'all' | 'send' | 'receive'>('all');
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  const handleLangChange = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem('dropqtt_lang', newLang);
  };

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('dropqtt_theme', newTheme);
  };

  const handleSaveProfile = (name: string, newConfig: BrokerConfig) => {
    const newProfile: BrokerProfile = {
      id: Date.now().toString(),
      name,
      config: newConfig,
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

  // 3. Auto-Updater Check
  const handleCheckUpdate = async () => {
    setUpdateStatusText(t.checkingUpdate);
    try {
      const update = await check();
      if (update?.available) {
        setUpdateStatusText(`${t.newVersionAvailable} (${update.version})`);
      } else {
        setUpdateStatusText(t.upToDate);
      }
    } catch {
      // Running in local dev or without release signature endpoint
      setUpdateStatusText(t.upToDate);
    }
    setTimeout(() => {
      setUpdateStatusText(null);
    }, 4000);
  };

  useEffect(() => {
    // 1. Get default download folder
    invoke<string>('get_default_download_dir')
      .then((dir) => setDownloadDir(dir))
      .catch((err) => console.error('get_default_download_dir err:', err));

    // 2. Connect to initial broker
    handleConnect(config);

    // 3. Listen for broker status
    const unlistenStatus = listen<ConnectionStatus>('broker-status', (event) => {
      setStatus(event.payload);
    });

    const unlistenDisconnect = listen<string>('broker-disconnected', () => {
      setStatus((prev) => ({ ...prev, connected: false }));
    });

    // 4. Listen for transfer progress updates
    const unlistenProgress = listen<TransferProgress>('transfer-progress', (event) => {
      const p = event.payload;
      setTransfers((prev) => {
        const wasCompleted = prev[p.transferId]?.status === 'completed';
        if (!wasCompleted && p.status === 'completed') {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.8 },
          });
        }
        return {
          ...prev,
          [p.transferId]: p,
        };
      });
    });

    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
    };
  }, []);

  const handleConnect = async (newConfig: BrokerConfig) => {
    try {
      setConfig(newConfig);
      localStorage.setItem('dropqtt_active_broker', JSON.stringify(newConfig));
      await invoke('connect_broker', { config: newConfig });
      const currentStatus = await invoke<ConnectionStatus>('get_connection_status');
      setStatus(currentStatus);
    } catch (err) {
      console.error('Failed to connect broker:', err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke('disconnect_broker');
      setStatus((prev) => ({ ...prev, connected: false }));
    } catch (err) {
      console.error('Failed to disconnect broker:', err);
    }
  };

  const handleChannelChange = async (newChannel: string) => {
    try {
      await invoke('join_channel', { channel: newChannel });
      setStatus((prev) => ({ ...prev, channel: newChannel }));
    } catch (err) {
      console.error('Failed to switch channel:', err);
    }
  };

  const handleSendFile = async (filePath: string, chunkSize: number, qos: number) => {
    try {
      await invoke('start_send_file', {
        filePath,
        chunkSize,
        qos,
      });
    } catch (err) {
      console.error('Send file invocation error:', err);
      alert(`Send Error: ${err}`);
    }
  };

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

  const handleChangeDownloadDir = async (newDir: string) => {
    try {
      await invoke('set_download_dir', { path: newDir });
      setDownloadDir(newDir);
    } catch (err) {
      console.error('Failed to set download directory:', err);
    }
  };

  const transferList = Object.values(transfers).reverse();
  const filteredTransfers = transferList.filter((tItem) => {
    if (filterTab === 'send') return tItem.direction === 'send';
    if (filterTab === 'receive') return tItem.direction === 'receive';
    return true;
  });

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-300"
      style={{
        background: currentTheme.bodyBg,
        color: currentTheme.textPrimary,
      }}
    >
      {/* Top Navigation Bar */}
      <Navbar
        status={status}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onChannelChange={handleChannelChange}
        lang={lang}
        onLangChange={handleLangChange}
        theme={theme}
        onThemeChange={handleThemeChange}
        t={t}
        onCheckUpdate={handleCheckUpdate}
        updateStatusText={updateStatusText}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        {/* Active Broker Info & Quick Actions Banner */}
        <BrokerCard
          status={status}
          config={config}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onQuickSwitch={handleConnect}
          profiles={profiles}
          t={t}
        />

        {/* Top Two Panels: Send & Receive */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SendCard
            isConnected={status.connected}
            channel={status.channel}
            onSendFile={handleSendFile}
            t={t}
          />
          <ReceiveCard
            downloadDir={downloadDir}
            onChangeDownloadDir={handleChangeDownloadDir}
            channel={status.channel}
            isConnected={status.connected}
            t={t}
          />
        </div>

        {/* Transfer Management & History */}
        <div className="rounded-2xl glass-card p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold">{t.transfersQueue}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 font-mono">
                {transferList.length}
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center p-1 rounded-lg bg-black/30 border border-white/10 text-xs">
              <button
                onClick={() => setFilterTab('all')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 font-medium'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{t.allTransfers}</span>
              </button>
              <button
                onClick={() => setFilterTab('send')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'send'
                    ? 'bg-cyan-500/20 text-cyan-300 font-medium'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t.sendTab}</span>
              </button>
              <button
                onClick={() => setFilterTab('receive')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'receive'
                    ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>{t.receiveTab}</span>
              </button>
            </div>
          </div>

          {/* Transfers list */}
          {filteredTransfers.length === 0 ? (
            <div className="text-center py-12 opacity-60 space-y-2">
              <div className="w-12 h-12 rounded-xl bg-black/20 mx-auto flex items-center justify-center border border-white/10">
                <Inbox className="w-6 h-6" />
              </div>
              <p className="text-xs font-medium">{t.noTransfers}</p>
              <p className="text-[11px] opacity-75">
                {t.noTransfersDesc}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTransfers.map((item) => (
                <TransferItem
                  key={item.transferId}
                  transfer={item}
                  onPause={handlePause}
                  onResume={handleResume}
                  onCancel={handleCancel}
                  onReveal={handleReveal}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSaveAndConnect={handleConnect}
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
