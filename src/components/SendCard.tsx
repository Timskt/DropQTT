import React, { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { UploadCloud, File, Layers, Zap, ArrowUpRight } from 'lucide-react';

interface SendCardProps {
  isConnected: boolean;
  channel: string;
  onSendFile: (filePath: string, chunkSize: number, qos: number) => Promise<void>;
}

const CHUNK_OPTIONS = [
  { label: '64 KB (IoT / Restricted)', value: 64 * 1024 },
  { label: '128 KB', value: 128 * 1024 },
  { label: '256 KB (Recommended)', value: 256 * 1024 },
  { label: '512 KB', value: 512 * 1024 },
  { label: '1 MB (Fast Broker)', value: 1024 * 1024 },
  { label: '2 MB (Maximum)', value: 2 * 1024 * 1024 },
];

export const SendCard: React.FC<SendCardProps> = ({ isConnected, channel, onSendFile }) => {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [chunkSize, setChunkSize] = useState<number>(256 * 1024);
  const [qos, setQos] = useState<number>(1);
  const [isSending, setIsSending] = useState(false);

  const handlePickFile = async () => {
    try {
      const result = await open({
        multiple: false,
        directory: false,
        title: 'Select File to Send via DropQTT',
      });
      if (result && typeof result === 'string') {
        setSelectedPath(result);
      }
    } catch (err) {
      console.error('Error selecting file:', err);
    }
  };

  const handleSend = async () => {
    if (!selectedPath || !isConnected) return;
    setIsSending(true);
    try {
      await onSendFile(selectedPath, chunkSize, qos);
      setSelectedPath(null);
    } catch (err) {
      console.error('Failed to dispatch file send:', err);
    } finally {
      setIsSending(false);
    }
  };

  const getFileName = (path: string) => {
    return path.split(/[/\\]/).pop() || path;
  };

  return (
    <div className="rounded-2xl glass-card p-6 flex flex-col justify-between relative overflow-hidden border border-slate-700/60 shadow-xl">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <UploadCloud className="w-4 h-4 text-cyan-400" />
            <span>Send Files via MQTT</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50">
            Channel: #{channel}
          </span>
        </div>

        {/* Dropzone / Picker */}
        <div
          onClick={handlePickFile}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${
            selectedPath
              ? 'border-cyan-500/60 bg-cyan-500/5 hover:bg-cyan-500/10'
              : 'border-slate-700 hover:border-slate-500 bg-slate-800/30 hover:bg-slate-800/50'
          }`}
        >
          {selectedPath ? (
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center mb-2 shadow-inner">
                <File className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-white max-w-xs truncate">{getFileName(selectedPath)}</p>
              <p className="text-[11px] font-mono text-slate-400 mt-1 truncate max-w-sm">{selectedPath}</p>
              <span className="mt-3 text-xs text-cyan-400 font-medium hover:underline">Click to change file</span>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
                <UploadCloud className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-200">Click to choose a file</p>
              <p className="text-xs text-slate-400 mt-1">Files of any size streamed reliably through MQTT chunks</p>
            </div>
          )}
        </div>

        {/* Transfer Options */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Packet Chunk Size</span>
            </label>
            <select
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              className="w-full text-xs py-2 px-2.5 rounded-lg glass-input text-slate-200 bg-slate-800/80 font-mono"
            >
              {CHUNK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>MQTT QoS Level</span>
            </label>
            <select
              value={qos}
              onChange={(e) => setQos(Number(e.target.value))}
              className="w-full text-xs py-2 px-2.5 rounded-lg glass-input text-slate-200 bg-slate-800/80 font-mono"
            >
              <option value={0}>QoS 0 - At Most Once (Fastest)</option>
              <option value={1}>QoS 1 - At Least Once (Reliable)</option>
              <option value={2}>QoS 2 - Exactly Once (Strict)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSend}
        disabled={!selectedPath || !isConnected || isSending}
        className={`mt-5 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm transition-all shadow-lg ${
          !selectedPath || !isConnected || isSending
            ? 'bg-slate-800/80 text-slate-500 border border-slate-700/50 cursor-not-allowed shadow-none'
            : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-bold shadow-cyan-500/20 active:scale-98'
        }`}
      >
        {isSending ? (
          <span>Streaming Chunks...</span>
        ) : !isConnected ? (
          <span>Connect Broker First</span>
        ) : !selectedPath ? (
          <span>Select a File to Send</span>
        ) : (
          <>
            <span>Start Transmission</span>
            <ArrowUpRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
};
