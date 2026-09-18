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

  modeFileTransfer: string;
  modeMqttClient: string;
  modeFileTransferDesc: string;
  modeMqttClientDesc: string;
  publishTopic: string;
  publishTopicHint: string;
  subscribeTopic: string;
  subscribeTopicHint: string;
  topicPreview: string;
  metaTopicPreview: string;
  chunkTopicPreview: string;
  ctrlTopicPreview: string;
  multiFileSelect: string;
  batchQueue: string;
  clearBatch: string;
  sendBatch: string;
  sendingBatch: string;
  totalFiles: string;
  totalSize: string;
  addFiles: string;
  pending: string;
  sending: string;
  completed: string;
  subscriptions: string;
  addSubscription: string;
  topicPattern: string;
  subscribe: string;
  unsubscribe: string;
  noSubscriptions: string;
  messageStream: string;
  clearMessages: string;
  filterTopic: string;
  allDirections: string;
  inbound: string;
  outbound: string;
  publisher: string;
  payload: string;
  retain: string;
  publish: string;
  formatJson: string;
  formatRaw: string;
  formatHex: string;
  copy: string;
  copied: string;
  publishSuccess: string;
  activeSubs: string;
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
    dropHint: '支持多选与任意大小文件，自动切片流式传送并计算 SHA-256 校验',
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
    upToDate: '已是最新版本 (v0.2.0)',
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

    modeFileTransfer: '文件传输工作台',
    modeMqttClient: 'MQTT 客户端控制台',
    modeFileTransferDesc: '大文件切片流式发送与自动校验重组',
    modeMqttClientDesc: '通用 MQTT 消息订阅、发布与实时数据流检测',
    publishTopic: '发送主题 (Publish Topic)',
    publishTopicHint: '自定义发送主题前缀，例如: dropqtt/lobby 或 iot/dev01/files',
    subscribeTopic: '接收订阅主题 (Subscribe Topic)',
    subscribeTopicHint: '自定义监听主题通配符，例如: dropqtt/lobby/# 或 iot/dev01/files/#',
    topicPreview: '主题拓扑协议预览',
    metaTopicPreview: '文件元信息',
    chunkTopicPreview: '数据分片流',
    ctrlTopicPreview: '控制确认回执',
    multiFileSelect: '选择文件 (支持多选)',
    batchQueue: '待发文件队列',
    clearBatch: '清空列表',
    sendBatch: '批量顺序发送',
    sendingBatch: '正在发送批次 ({current}/{total})',
    totalFiles: '共 {count} 个文件',
    totalSize: '总容量: {size}',
    addFiles: '追加文件',
    pending: '等待中',
    sending: '传输中',
    completed: '传输完成',
    subscriptions: '主题订阅管理器',
    addSubscription: '新增订阅',
    topicPattern: '主题表达式 (例如: sensor/+/data, device/#)',
    subscribe: '订阅',
    unsubscribe: '退订',
    noSubscriptions: '暂无活动订阅主题，请在上方输入主题表达式添加',
    messageStream: '实时报文监测流',
    clearMessages: '清空报文',
    filterTopic: '按主题或报文正文筛选...',
    allDirections: '全部方向',
    inbound: '接收 (IN)',
    outbound: '发送 (OUT)',
    publisher: '报文快速发布器',
    payload: '报文正文内容 (Payload)',
    retain: '保留消息 (Retain)',
    publish: '发布报文',
    formatJson: 'JSON 格式化',
    formatRaw: 'RAW 原生文本',
    formatHex: 'HEX 十六进制',
    copy: '复制',
    copied: '已复制',
    publishSuccess: '报文已成功发布',
    activeSubs: '活跃订阅',
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
    keepAlive: 'Keep Alive Interval (s)',
    sendTab: 'Send',
    sendTitle: 'Send Files via MQTT Chunks',
    receiveTab: 'Receive',
    receiveTitle: 'Chunk Reassembly Receiver',
    allTransfers: 'All Transfers',
    clickOrDrop: 'Click to select or drag files here',
    dropHint: 'Supports multi-file batch & any file size with SHA-256 integrity verification',
    changeFile: 'Change selected file',
    packetChunkSize: 'Packet Chunk Size',
    qosLevel: 'MQTT Quality of Service (QoS)',
    qos0Desc: 'QoS 0 - At most once (Fastest)',
    qos1Desc: 'QoS 1 - At least once (Recommended)',
    qos2Desc: 'QoS 2 - Exactly once (Strict)',
    startTransmission: 'Start Chunked Transfer',
    streaming: 'Streaming data...',
    connectFirst: 'Connect to Broker first',
    selectFileFirst: 'Select files to send first',
    saveFolder: 'Download Directory',
    browse: 'Browse',
    autoReceiver: 'Reassembly Receiver',
    listening: 'Listening',
    offline: 'Offline',
    recvDesc1: 'Files broadcasted to this channel will be streamed directly into this directory',
    recvDesc2: 'End-to-end SHA-256 verification guarantees zero-defect deliveries',
    firewallTip: '💡 Firewall Advantage: Operates purely over standard MQTT ports (1883/8883) even when HTTP uploads or P2P connections are restricted.',
    transfersQueue: 'Transfer Queue',
    noTransfers: 'No active transfer tasks',
    noTransfersDesc: 'Queue files above or await incoming transfers on matching topics',
    speed: 'Transfer Speed',
    chunks: 'Chunks',
    verified: 'Verified',
    verifying: 'Computing Hash',
    paused: 'Paused',
    failed: 'Failed',
    cancelled: 'Cancelled',
    showInFolder: 'Show in Folder',
    pause: 'Pause',
    resume: 'Resume',
    theme: 'Theme Style',
    themeCyberpunk: 'Cyberpunk Neon',
    themeObsidian: 'Obsidian OLED',
    themeNord: 'Nord Frost',
    themeSolaris: 'Solaris Light',
    language: 'Language',
    autoUpdate: 'Auto Check Updates',
    checkForUpdates: 'Check for Updates',
    checkingUpdate: 'Checking for updates...',
    upToDate: 'Up to date (v0.2.0)',
    newVersionAvailable: 'New version available!',
    updateNow: 'Update Now',
    currentVersion: 'Current Version',
    integrityVerified: 'SHA-256 Integrity Verified',
    testConnection: 'Test Connection',
    testingConnection: 'Testing connection...',
    connectionSuccess: 'Connection OK ({ms}ms latency)',
    connectionFailed: 'Connection failed',
    baseTopic: 'Base Topic (Namespace)',
    baseTopicDesc: 'Topic prefix separating workspaces (default dropqtt)',
    activeBroker: 'Active Broker',
    brokerProfiles: 'Saved Profiles',
    saveProfile: 'Save as Preset Profile',
    profileName: 'Profile Name (e.g. Private Server)',
    deleteProfile: 'Delete Profile',
    customBroker: 'Custom Broker',
    manageBrokers: 'Broker Settings',
    pingBroker: 'Ping Latency',
    testLatency: 'Ping',

    modeFileTransfer: 'File Transfer Hub',
    modeMqttClient: 'MQTT Console',
    modeFileTransferDesc: 'Chunked file transmission with SHA-256 validation',
    modeMqttClientDesc: 'Full MQTT topic subscriptions, live stream & message publishing',
    publishTopic: 'Publish Topic',
    publishTopicHint: 'Custom target topic prefix, e.g. dropqtt/lobby or factory/edge1/files',
    subscribeTopic: 'Subscribe Topic',
    subscribeTopicHint: 'Custom listening wildcard topic, e.g. dropqtt/lobby/# or factory/edge1/files/#',
    topicPreview: 'Protocol Topic Hierarchy',
    metaTopicPreview: 'Metadata',
    chunkTopicPreview: 'Chunk Stream',
    ctrlTopicPreview: 'Control ACK',
    multiFileSelect: 'Select Files (Multi-file)',
    batchQueue: 'Outbox Batch Queue',
    clearBatch: 'Clear Queue',
    sendBatch: 'Send Batch Sequentially',
    sendingBatch: 'Streaming batch ({current}/{total})',
    totalFiles: '{count} file(s)',
    totalSize: 'Total Size: {size}',
    addFiles: 'Add More Files',
    pending: 'Pending',
    sending: 'Sending',
    completed: 'Done',
    subscriptions: 'Subscriptions Manager',
    addSubscription: 'New Subscription',
    topicPattern: 'Topic Pattern (e.g. sensor/+/data, device/#)',
    subscribe: 'Subscribe',
    unsubscribe: 'Unsubscribe',
    noSubscriptions: 'No active topic subscriptions. Add one above to inspect live traffic.',
    messageStream: 'Live Message Feed',
    clearMessages: 'Clear Messages',
    filterTopic: 'Search topic or payload content...',
    allDirections: 'All Traffic',
    inbound: 'Inbound (IN)',
    outbound: 'Outbound (OUT)',
    publisher: 'Message Publisher',
    payload: 'Payload Content',
    retain: 'Retain Flag',
    publish: 'Publish Message',
    formatJson: 'JSON View',
    formatRaw: 'RAW Text',
    formatHex: 'HEX Byte View',
    copy: 'Copy',
    copied: 'Copied',
    publishSuccess: 'Message published successfully',
    activeSubs: 'Active Subs',
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
    port: '埠號 (Port)',
    tls: 'TLS / SSL 安全加密',
    tlsDesc: '使用安全憑證加密傳輸 (例如 8883 埠)',
    clientId: '用戶端標識 (Client ID)',
    username: '使用者名稱 (選填)',
    password: '密碼 (選填)',
    defaultQos: '預設服務品質 (QoS)',
    keepAlive: '心跳保活間隔 (秒)',
    sendTab: '發送',
    sendTitle: '透過 MQTT 分片發送檔案',
    receiveTab: '接收',
    receiveTitle: '自動分片重組接收器',
    allTransfers: '全部傳輸',
    clickOrDrop: '點擊選擇或將檔案拖曳至此處',
    dropHint: '支援多選與任意大小檔案，自動切片串流傳送並計算 SHA-256 校驗',
    changeFile: '點擊更換已選檔案',
    packetChunkSize: '資料包分片大小 (Chunk Size)',
    qosLevel: 'MQTT 服務品質 (QoS)',
    qos0Desc: 'QoS 0 - 最多一次 (最快傳輸)',
    qos1Desc: 'QoS 1 - 至少一次 (推薦/可靠)',
    qos2Desc: 'QoS 2 - 準確一次 (嚴格可靠)',
    startTransmission: '開始分片高速傳輸',
    streaming: '資料串流傳輸中...',
    connectFirst: '請先連線 MQTT Broker',
    selectFileFirst: '請先選擇待發送的檔案',
    saveFolder: '檔案下載儲存目錄',
    browse: '瀏覽選擇',
    autoReceiver: '自動分片重組接收器',
    listening: '監聽中',
    offline: '離線',
    recvDesc1: '目前頻道廣播的檔案將直接串流下載到該目錄',
    recvDesc2: '全流程 SHA-256 校驗確保無錯漏重組交付',
    firewallTip: '💡 防火牆穿透優勢：僅需標準 MQTT 埠號 (1883/8883)，在阻斷 HTTP 上傳或直連 P2P 的網路環境下暢行無阻。',
    transfersQueue: '傳輸與流控佇列',
    noTransfers: '目前頻道暫無活動傳輸任務',
    noTransfersDesc: '在上方選擇檔案發送，或在相同頻道等待接收對端發送的檔案',
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
    upToDate: '已是最新版本 (v0.2.0)',
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

    modeFileTransfer: '檔案傳輸工作台',
    modeMqttClient: 'MQTT 用戶端控制台',
    modeFileTransferDesc: '大檔案切片串流發送與自動校驗重組',
    modeMqttClientDesc: '通用 MQTT 訊息訂閱、發布與即時資料流檢測',
    publishTopic: '發送主題 (Publish Topic)',
    publishTopicHint: '自訂發送主題前綴，例如: dropqtt/lobby 或 iot/dev01/files',
    subscribeTopic: '接收訂閱主題 (Subscribe Topic)',
    subscribeTopicHint: '自訂監聽主題萬用字元，例如: dropqtt/lobby/# 或 iot/dev01/files/#',
    topicPreview: '主題拓撲協定預覽',
    metaTopicPreview: '檔案元資訊',
    chunkTopicPreview: '資料分片流',
    ctrlTopicPreview: '控制確認回執',
    multiFileSelect: '選擇檔案 (支援多選)',
    batchQueue: '待發檔案佇列',
    clearBatch: '清空列表',
    sendBatch: '批次循序發送',
    sendingBatch: '正在發送批次 ({current}/{total})',
    totalFiles: '共 {count} 個檔案',
    totalSize: '總大小: {size}',
    addFiles: '追加檔案',
    pending: '等待中',
    sending: '傳輸中',
    completed: '傳輸完成',
    subscriptions: '主題訂閱管理器',
    addSubscription: '新增訂閱',
    topicPattern: '主題表達式 (例如: sensor/+/data, device/#)',
    subscribe: '訂閱',
    unsubscribe: '退訂',
    noSubscriptions: '暫無活動訂閱主題，請在上方輸入主題表達式新增',
    messageStream: '即時封包監測流',
    clearMessages: '清空封包',
    filterTopic: '按主題或本文篩選...',
    allDirections: '全部方向',
    inbound: '接收 (IN)',
    outbound: '發送 (OUT)',
    publisher: '封包快速發布器',
    payload: '封包內文 (Payload)',
    retain: '保留訊息 (Retain)',
    publish: '發布封包',
    formatJson: 'JSON 格式化',
    formatRaw: 'RAW 原生文字',
    formatHex: 'HEX 十六進位',
    copy: '複製',
    copied: '已複製',
    publishSuccess: '封包已成功發布',
    activeSubs: '活躍訂閱',
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
    dropHint: '複数ファイルのバッチ選択と SHA-256 チェックサム整合性検証をサポート',
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
    upToDate: '最新バージョンです (v0.2.0)',
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

    modeFileTransfer: 'ファイル転送ハブ',
    modeMqttClient: 'MQTT コンソール',
    modeFileTransferDesc: 'ファイルチャンク分割ストリーミングと自動整合性検証',
    modeMqttClientDesc: '汎用 MQTT トピック購読・パブリッシュおよびライブストリーム検査',
    publishTopic: '送信トピック (Publish Topic)',
    publishTopicHint: 'カスタム送信トピックプレフィックス、例: dropqtt/lobby または factory/line1/files',
    subscribeTopic: '受信購読トピック (Subscribe Topic)',
    subscribeTopicHint: 'カスタム受信ワイルドカード、例: dropqtt/lobby/# または factory/line1/files/#',
    topicPreview: 'トピック構造プレビュー',
    metaTopicPreview: 'メタデータ',
    chunkTopicPreview: 'チャンクストリーム',
    ctrlTopicPreview: '制御 ACK',
    multiFileSelect: 'ファイル選択 (複数可)',
    batchQueue: '送信キュー',
    clearBatch: 'クリア',
    sendBatch: 'バッチ送信開始',
    sendingBatch: 'バッチ送信中 ({current}/{total})',
    totalFiles: '{count} 個のファイル',
    totalSize: '合計サイズ: {size}',
    addFiles: 'ファイル追加',
    pending: '待機中',
    sending: '送信中',
    completed: '完了',
    subscriptions: 'サブスクリプション管理',
    addSubscription: '新規購読',
    topicPattern: 'トピックパターン (例: sensor/+/data, device/#)',
    subscribe: '購読',
    unsubscribe: '解除',
    noSubscriptions: 'アクティブな購読はありません。上の入力欄から追加してください。',
    messageStream: 'リアルタイム メッセージログ',
    clearMessages: 'ログクリア',
    filterTopic: 'トピックまたは内容で検索...',
    allDirections: 'すべての方向',
    inbound: '受信 (IN)',
    outbound: '送信 (OUT)',
    publisher: 'メッセージ送信',
    payload: 'ペイロード本文',
    retain: 'Retain フラグ',
    publish: '送信',
    formatJson: 'JSON 形式',
    formatRaw: 'RAW テキスト',
    formatHex: 'HEX 16進数',
    copy: 'コピー',
    copied: 'コピー完了',
    publishSuccess: 'メッセージを送信しました',
    activeSubs: '購読中',
  },
};
