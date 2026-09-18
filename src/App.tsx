import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import confetti from 'canvas-confetti';
import { Navbar } from './components/Navbar';
import { SendCard } from './components/SendCard';
import { ReceiveCard } from './components/ReceiveCard';
import { TransferItem } from './components/TransferItem';
import { SettingsModal } from './components/SettingsModal';
import { BrokerConfig, ConnectionStatus, TransferProgress } from './types';
import { Activity, Inbox, Send, Layers } from 'lucide-react';

export function App() {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    brokerHost: 'broker.emqx.io',
    brokerPort: 1883,
    channel: 'public-lobby',
    clientId: 'DropQTT_Client',
  });

  const [config, setConfig] = useState<BrokerConfig>({
    host: 'broker.emqx.io',
    port: 1883,
    useTls: false,
    clientId: `DropQTT_${Math.random().toString(36).substring(2, 8)}`,
    keepAliveSecs: 60,
    defaultQos: 1,
  });

  const [downloadDir, setDownloadDir] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  const [filterTab, setFilterTab] = useState<'all' | 'send' | 'receive'>('all');

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
          // Trigger pleasant celebratory confetti on verified completion
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
  const filteredTransfers = transferList.filter((t) => {
    if (filterTab === 'send') return t.direction === 'send';
    if (filterTab === 'receive') return t.direction === 'receive';
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#090b10] text-slate-100 selection:bg-cyan-500 selection:text-black">
      {/* Top Navigation */}
      <Navbar
        status={status}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onChannelChange={handleChannelChange}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        {/* Top Two Panels: Send & Receive */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SendCard
            isConnected={status.connected}
            channel={status.channel}
            onSendFile={handleSendFile}
          />
          <ReceiveCard
            downloadDir={downloadDir}
            onChangeDownloadDir={handleChangeDownloadDir}
            channel={status.channel}
            isConnected={status.connected}
          />
        </div>

        {/* Transfer Management & History */}
        <div className="rounded-2xl glass-card p-6 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Transfers & Streaming Queue</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                {transferList.length}
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center p-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <button
                onClick={() => setFilterTab('all')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>All</span>
              </button>
              <button
                onClick={() => setFilterTab('send')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'send'
                    ? 'bg-cyan-500/20 text-cyan-300 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>Sent</span>
              </button>
              <button
                onClick={() => setFilterTab('receive')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'receive'
                    ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>Received</span>
              </button>
            </div>
          </div>

          {/* Transfers list */}
          {filteredTransfers.length === 0 ? (
            <div className="text-center py-12 text-slate-500 space-y-2">
              <div className="w-12 h-12 rounded-xl bg-slate-900 mx-auto flex items-center justify-center border border-slate-800 text-slate-600">
                <Inbox className="w-6 h-6" />
              </div>
              <p className="text-xs font-medium text-slate-400">No active or past transfers in this channel</p>
              <p className="text-[11px] text-slate-500">
                Drop a file above or have someone send a file to #{status.channel}
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
      />
    </div>
  );
}

export default App;
