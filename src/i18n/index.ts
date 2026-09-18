export type Language = 'zh-CN' | 'en' | 'zh-TW' | 'ja';

export interface Translations {
  appName: string;
  tagline: string;
  channel: string;
  connected: string;
  disconnected: string;
  connect: string;
  saveAndConnect: string;
  cancel: string;
  settings: string;
  brokerConfig: string;
  brokerPresets: string;
  brokerHost: string;
  port: string;
  tls: string;
  tlsDesc: string;
  clientId: string;
  username: string;
  password: string;
  defaultQos: string;
  keepAlive: string;
  sendTab: string;
  sendTitle: string;
  receiveTab: string;
  receiveTitle: string;
  allTransfers: string;
  clickOrDrop: string;
  dropHint: string;
  changeFile: string;
  packetChunkSize: string;
  qosLevel: string;
  qos0Desc: string;
  qos1Desc: string;
  qos2Desc: string;
  startTransmission: string;
  streaming: string;
  connectFirst: string;
  selectFileFirst: string;
  saveFolder: string;
  browse: string;
  autoReceiver: string;
  listening: string;
  offline: string;
  recvDesc1: string;
  recvDesc2: string;
  firewallTip: string;
  transfersQueue: string;
  noTransfers: string;
  noTransfersDesc: string;
  speed: string;
  chunks: string;
  verified: string;
  verifying: string;
  paused: string;
  failed: string;
  cancelled: string;
  showInFolder: string;
  pause: string;
  resume: string;
  theme: string;
  themeCyberpunk: string;
  themeObsidian: string;
  themeNord: string;
  themeSolaris: string;
  language: string;
  autoUpdate: string;
  checkForUpdates: string;
  checkingUpdate: string;
  upToDate: string;
  newVersionAvailable: string;
  updateNow: string;
  currentVersion: string;
  integrityVerified: string;
  testConnection: string;
  testingConnection: string;
  connectionSuccess: string;
  connectionFailed: string;
  baseTopic: string;
  baseTopicDesc: string;
  activeBroker: string;
  brokerProfiles: string;
  saveProfile: string;
  profileName: string;
  deleteProfile: string;
  customBroker: string;
  manageBrokers: string;
  pingBroker: string;
  testLatency: string;
}

export const translations: Record<Language, Translations> = {
  'zh-CN': {
    appName: 'DropQTT',
    tagline: '基于 MQTT 的高可靠跨平台文件传输工具',
    channel: '传输房间频道',
    connected: '已连接',
    disconnected: '未连接',
    connect: '连接',
    saveAndConnect: '保存并连接',
    cancel: '取消',
    settings: 'MQTT Broker 设置',
    brokerConfig: 'MQTT Broker 服务器配置',
    brokerPresets: '常用公共 Broker 预设',
    brokerHost: '服务器地址 / IP',
    port: '端口',
    tls: 'TLS / SSL 安全加密',
    tlsDesc: '使用安全证书加密传输 (例如 8883 端口)',
    clientId: '客户端标识 (Client ID)',
    username: '用户名 (可选)',
    password: '密码 (可选)',
    defaultQos: '默认服务质量 (QoS)',
    keepAlive: '心跳保活间隔 (秒)',
    sendTab: '发送',
    sendTitle: '通过 MQTT 分片发送文件',
    receiveTab: '接收',
    receiveTitle: '自动分片重组接收器',
    allTransfers: '全部传输',
    clickOrDrop: '点击选择或将文件拖拽至此处',
    dropHint: '支持任意大小文件，自动切片流式传送并计算哈希校验',
    changeFile: '点击更换已选文件',
    packetChunkSize: '数据包分片大小 (Chunk Size)',
    qosLevel: 'MQTT 服务质量 (QoS)',
    qos0Desc: 'QoS 0 - 最多一次 (最快传输)',
    qos1Desc: 'QoS 1 - 至少一次 (推荐/可靠)',
    qos2Desc: 'QoS 2 - 准确一次 (严格可靠)',
    startTransmission: '开始分片高速传输',
    streaming: '数据流传输中...',
    connectFirst: '请先连接 MQTT Broker',
    selectFileFirst: '请先选择待发送的文件',
    saveFolder: '文件下载保存目录',
    browse: '浏览选择',
    autoReceiver: '自动分片重组接收器',
    listening: '监听中',
    offline: '离线',
    recvDesc1: '当前频道广播的文件将直接流式下载到该目录',
    recvDesc2: '全流程 SHA-256 校验确保无错漏重组交付',
    firewallTip: '💡 防火墙穿透优势：仅需标准 MQTT 端口 (1883/8883)，在阻断 HTTP 上传或直连 P2P 的网络环境下畅行无阻。',
    transfersQueue: '传输与流控队列',
    noTransfers: '当前频道暂无活动传输任务',
    noTransfersDesc: '在上方选择文件发送，或在相同频道等待接收对端发送的文件',
    speed: '传输速率',
    chunks: '分片进度',
    verified: '校验通过',
    verifying: '计算哈希校验',
    paused: '已暂停',
    failed: '传输失败',
    cancelled: '已取消',
    showInFolder: '在文件夹中显示',
    pause: '暂停',
    resume: '继续',
    theme: '主题皮肤',
    themeCyberpunk: '赛博霓虹 (Cyberpunk)',
    themeObsidian: '暗夜曜石 (Obsidian OLED)',
    themeNord: '极光极地 (Nord Frost)',
    themeSolaris: '晨曦浅色 (Solaris Light)',
    language: '界面语言',
    autoUpdate: '自动检查更新',
    checkForUpdates: '检查最新版本',
    checkingUpdate: '正在检查更新...',
    upToDate: '已是最新版本 (v0.1.3)',
    newVersionAvailable: '发现新版本可用！',
    updateNow: '立即更新',
    currentVersion: '当前版本',
    integrityVerified: 'SHA-256 完整性已通过',
    testConnection: '测试连接',
    testingConnection: '正在测试连接...',
    connectionSuccess: '连接成功 (延迟: {ms}ms)',
    connectionFailed: '连接失败',
    baseTopic: 'MQTT 根主题 (Namespace)',
    baseTopicDesc: '用于隔离团队或不同设备的主题前缀 (默认 dropqtt)',
    activeBroker: '当前 Broker',
    brokerProfiles: '常用配置预设',
    saveProfile: '保存为常用预设',
    profileName: '配置名称 (例如: 私有服务器)',
    deleteProfile: '删除配置',
    customBroker: '自定义 Broker',
    manageBrokers: '配置 / 切换 Broker',
    pingBroker: '延迟测速',
    testLatency: '测速',
  },
  'en': {
    appName: 'DropQTT',
    tagline: 'High-speed Resilient File Transfer Over MQTT',
    channel: 'Room Channel',
    connected: 'Connected',
    disconnected: 'Disconnected',
    connect: 'Connect',
    saveAndConnect: 'Save & Connect',
    cancel: 'Cancel',
    settings: 'MQTT Broker Settings',
    brokerConfig: 'MQTT Broker Configuration',
    brokerPresets: 'Public Broker Presets',
    brokerHost: 'Broker Host / IP',
    port: 'Port',
    tls: 'TLS / SSL Encryption',
    tlsDesc: 'Encrypted transfer (e.g. port 8883)',
    clientId: 'Client Identifier (Client ID)',
    username: 'Username (Optional)',
    password: 'Password (Optional)',
    defaultQos: 'Default QoS Level',
    keepAlive: 'Keep-Alive (Seconds)',
    sendTab: 'Sent',
    sendTitle: 'Stream Files via MQTT Chunks',
    receiveTab: 'Received',
    receiveTitle: 'Automatic Receiver & Assembler',
    allTransfers: 'All Transfers',
    clickOrDrop: 'Click to select or drop a file here',
    dropHint: 'Streams files of any size via chunking with SHA-256 verification',
    changeFile: 'Click to change selected file',
    packetChunkSize: 'Packet Chunk Size',
    qosLevel: 'MQTT QoS Level',
    qos0Desc: 'QoS 0 - At most once (Fastest)',
    qos1Desc: 'QoS 1 - At least once (Recommended)',
    qos2Desc: 'QoS 2 - Exactly once (Strict)',
    startTransmission: 'Start Transmission',
    streaming: 'Streaming Chunks...',
    connectFirst: 'Connect Broker First',
    selectFileFirst: 'Select a file to send',
    saveFolder: 'Download Destination Folder',
    browse: 'Browse',
    autoReceiver: 'Automatic Receiver',
    listening: 'Listening',
    offline: 'Offline',
    recvDesc1: 'Files broadcasted to this channel stream directly into this directory',
    recvDesc2: 'End-to-end SHA-256 check ensures bit-perfect reassembly without packet corruption',
    firewallTip: '💡 Firewall bypass: Operates over standard MQTT ports (1883/8883) where HTTP or P2P is blocked.',
    transfersQueue: 'Transfers & Queue',
    noTransfers: 'No transfers in this channel',
    noTransfersDesc: 'Drop a file above or wait for incoming transmissions on this channel',
    speed: 'Speed',
    chunks: 'Chunks',
    verified: 'Verified',
    verifying: 'Verifying Hash',
    paused: 'Paused',
    failed: 'Failed',
    cancelled: 'Cancelled',
    showInFolder: 'Show in Folder',
    pause: 'Pause',
    resume: 'Resume',
    theme: 'Theme / Skin',
    themeCyberpunk: 'Cyberpunk Neon',
    themeObsidian: 'Midnight Obsidian (OLED)',
    themeNord: 'Nord Frost',
    themeSolaris: 'Solaris Light',
    language: 'Language',
    autoUpdate: 'Auto Update',
    checkForUpdates: 'Check for Updates',
    checkingUpdate: 'Checking for updates...',
    upToDate: 'Up to date (v0.1.3)',
    newVersionAvailable: 'New version available!',
    updateNow: 'Update Now',
    currentVersion: 'Current Version',
    integrityVerified: 'SHA-256 Integrity Verified',
    testConnection: 'Test Connection',
    testingConnection: 'Testing connection...',
    connectionSuccess: 'Connected successfully ({ms}ms)',
    connectionFailed: 'Connection failed',
    baseTopic: 'MQTT Base Topic (Namespace)',
    baseTopicDesc: 'Namespace prefix to isolate transfers (Default: dropqtt)',
    activeBroker: 'Active Broker',
    brokerProfiles: 'Saved Profiles',
    saveProfile: 'Save As Preset',
    profileName: 'Profile Name (e.g. Private Server)',
    deleteProfile: 'Delete',
    customBroker: 'Custom Broker',
    manageBrokers: 'Configure / Switch Broker',
    pingBroker: 'Ping Latency',
    testLatency: 'Ping',
  },
  'zh-TW': {
    appName: 'DropQTT',
    tagline: '基於 MQTT 的高可靠跨平台檔案傳輸工具',
    channel: '傳輸房間頻道',
    connected: '已連線',
    disconnected: '未連線',
    connect: '連線',
    saveAndConnect: '儲存並連線',
    cancel: '取消',
    settings: 'MQTT Broker 設定',
    brokerConfig: 'MQTT Broker 伺服器配置',
    brokerPresets: '常用公共 Broker 預設',
    brokerHost: '伺服器位址 / IP',
    port: '連接埠',
    tls: 'TLS / SSL 安全加密',
    tlsDesc: '使用安全憑證加密傳輸 (例如 8883 連接埠)',
    clientId: '客戶端識別碼 (Client ID)',
    username: '使用者名稱 (可選)',
    password: '密碼 (可選)',
    defaultQos: '預設服務品質 (QoS)',
    keepAlive: '心跳保活間隔 (秒)',
    sendTab: '發送',
    sendTitle: '透過 MQTT 分片發送檔案',
    receiveTab: '接收',
    receiveTitle: '自動分片重組接收器',
    allTransfers: '全部傳輸',
    clickOrDrop: '點選選取或拖曳檔案至此',
    dropHint: '支援任意大小檔案，自動切片流式傳送並計算雜湊校驗',
    changeFile: '點選更換已選檔案',
    packetChunkSize: '資料包分片大小 (Chunk Size)',
    qosLevel: 'MQTT 服務品質 (QoS)',
    qos0Desc: 'QoS 0 - 最多一次 (最快傳輸)',
    qos1Desc: 'QoS 1 - 至少一次 (推薦/可靠)',
    qos2Desc: 'QoS 2 - 準確一次 (嚴格可靠)',
    startTransmission: '開始分片高速傳輸',
    streaming: '資料流傳輸中...',
    connectFirst: '請先連線 MQTT Broker',
    selectFileFirst: '請先選取待發送的檔案',
    saveFolder: '檔案下載儲存目錄',
    browse: '瀏覽選擇',
    autoReceiver: '自動分片重組接收器',
    listening: '監聽中',
    offline: '離線',
    recvDesc1: '目前頻道廣播的檔案將直接流式下載到該目錄',
    recvDesc2: '全流程 SHA-256 校驗確保無錯漏重組交付',
    firewallTip: '💡 防火牆穿透優勢：僅需標準 MQTT 連接埠 (1883/8883)，在阻斷 HTTP 上傳或直連 P2P 的網路環境下暢行無阻。',
    transfersQueue: '傳輸與流控佇列',
    noTransfers: '目前頻道暫無活動傳輸任務',
    noTransfersDesc: '在上方選取檔案發送，或在相同頻道等待接收對端發送的檔案',
    speed: '傳輸速率',
    chunks: '分片進度',
    verified: '校驗通過',
    verifying: '計算雜湊校驗',
    paused: '已暫停',
    failed: '傳輸失敗',
    cancelled: '已取消',
    showInFolder: '在資料夾中顯示',
    pause: '暫停',
    resume: '繼續',
    theme: '主題面板',
    themeCyberpunk: '賽博霓虹 (Cyberpunk)',
    themeObsidian: '暗夜曜石 (Obsidian OLED)',
    themeNord: '極光極地 (Nord Frost)',
    themeSolaris: '晨曦淺色 (Solaris Light)',
    language: '介面語言',
    autoUpdate: '自動檢查更新',
    checkForUpdates: '檢查最新版本',
    checkingUpdate: '正在檢查更新...',
    upToDate: '已是最新版本 (v0.1.3)',
    newVersionAvailable: '發現新版本可用！',
    updateNow: '立即更新',
    currentVersion: '目前版本',
    integrityVerified: 'SHA-256 完整性已通過',
    testConnection: '測試連線',
    testingConnection: '正在測試連線...',
    connectionSuccess: '連線成功 (延遲: {ms}ms)',
    connectionFailed: '連線失敗',
    baseTopic: 'MQTT 根主題 (Namespace)',
    baseTopicDesc: '用於隔離團隊或不同設備的主題前綴 (預設 dropqtt)',
    activeBroker: '目前 Broker',
    brokerProfiles: '常用配置預設',
    saveProfile: '儲存為常用預設',
    profileName: '配置名稱 (例如: 私有伺服器)',
    deleteProfile: '刪除配置',
    customBroker: '自訂 Broker',
    manageBrokers: '配置 / 切換 Broker',
    pingBroker: '延遲測速',
    testLatency: '測速',
  },
  'ja': {
    appName: 'DropQTT',
    tagline: 'MQTT ベースの耐障害性クロスプラットフォーム ファイル転送ツール',
    channel: 'ルーム チャンネル',
    connected: '接続済み',
    disconnected: '切断',
    connect: '接続',
    saveAndConnect: '保存して接続',
    cancel: 'キャンセル',
    settings: 'MQTT ブローカー設定',
    brokerConfig: 'MQTT ブローカー構成',
    brokerPresets: 'パブリック ブローカー プリセット',
    brokerHost: 'ホスト / IP',
    port: 'ポート',
    tls: 'TLS / SSL 暗号化',
    tlsDesc: 'セキュア暗号化転送 (例: ポート 8883)',
    clientId: 'クライアント ID',
    username: 'ユーザー名 (任意)',
    password: 'パスワード (任意)',
    defaultQos: 'デフォルト QoS',
    keepAlive: 'キープアライブ (秒)',
    sendTab: '送信',
    sendTitle: 'MQTT チャンクでファイルを送信',
    receiveTab: '受信',
    receiveTitle: '自動チャンク再構成レシーバー',
    allTransfers: 'すべての転送',
    clickOrDrop: 'クリックしてファイルを選択またはドロップ',
    dropHint: '任意のサイズのファイルをチャンク分割してストリーミング転送',
    changeFile: 'ファイル変更',
    packetChunkSize: 'チャンクサイズ',
    qosLevel: 'MQTT QoS レベル',
    qos0Desc: 'QoS 0 - 最大1回 (最速)',
    qos1Desc: 'QoS 1 - 少なくとも1回 (推奨/確実)',
    qos2Desc: 'QoS 2 - 正確に1回 (厳格)',
    startTransmission: '高速転送を開始',
    streaming: 'ストリーミング中...',
    connectFirst: 'ブローカーに接続してください',
    selectFileFirst: '送信するファイルを選択してください',
    saveFolder: 'ダウンロード先フォルダー',
    browse: '参照',
    autoReceiver: '自動レシーバー',
    listening: '待機中',
    offline: 'オフライン',
    recvDesc1: 'このチャンネルに送信されたファイルは直接このフォルダーに保存されます',
    recvDesc2: 'SHA-256 チェックサムにより完全な整合性を保証',
    firewallTip: '💡 ファイアウォール回避: HTTP/P2P がブロックされている環境でも標準 MQTT ポート (1883/8883) で機能します。',
    transfersQueue: '転送キュー',
    noTransfers: '転送タスクはありません',
    noTransfersDesc: 'ファイルを送信するか、同じチャンネルでのファイル受信を待機してください',
    speed: '速度',
    chunks: 'チャンク',
    verified: '検証完了',
    verifying: 'ハッシュ検証中',
    paused: '一時停止',
    failed: '失敗',
    cancelled: 'キャンセル済み',
    showInFolder: 'フォルダーで表示',
    pause: '一時停止',
    resume: '再開',
    theme: 'テーマスキン',
    themeCyberpunk: 'サイバーパンク (Cyberpunk)',
    themeObsidian: 'オブシディアン (Obsidian OLED)',
    themeNord: 'ノルド フロスト (Nord Frost)',
    themeSolaris: 'ソラリス ライト (Solaris Light)',
    language: '言語設定',
    autoUpdate: '自動アップデート',
    checkForUpdates: 'アップデートを確認',
    checkingUpdate: '確認中...',
    upToDate: '最新バージョンです (v0.1.3)',
    newVersionAvailable: '新しいバージョンが利用可能です！',
    updateNow: '今すぐアップデート',
    currentVersion: '現在のバージョン',
    integrityVerified: 'SHA-256 整合性確認済み',
    testConnection: '接続テスト',
    testingConnection: '接続テスト中...',
    connectionSuccess: '接続成功 (レイテンシ: {ms}ms)',
    connectionFailed: '接続失敗',
    baseTopic: 'MQTT ベース トピック (Namespace)',
    baseTopicDesc: '転送チャンネルを分離するためのプレフィックス (デフォルト dropqtt)',
    activeBroker: 'アクティブ ブローカー',
    brokerProfiles: '保存されたプロファイル',
    saveProfile: 'プロファイルとして保存',
    profileName: 'プロファイル名 (例: プライベートサーバー)',
    deleteProfile: '削除',
    customBroker: 'カスタムブローカー',
    manageBrokers: 'ブローカー設定・切替',
    pingBroker: 'PING レイテンシ',
    testLatency: '測速',
  },
};
