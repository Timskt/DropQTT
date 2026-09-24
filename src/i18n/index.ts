export type Language = 'zh-CN' | 'en' | 'zh-TW' | 'ja';

export interface Translations {
  appName: string;
  tagline: string;
  channel: string;
  connected: string;
  disconnected: string;
  disconnect: string;
  connect: string;
  saveAndConnect: string;
  cancel: string;
  settings: string;
  skipToContent: string;
  brokerConfig: string;
  brokerPresets: string;
  brokerHost: string;
  port: string;
  tls: string;
  tlsDesc: string;
  advancedConn: string;
  transport: string;
  transportTcp: string;
  transportWs: string;
  willTopic: string;
  willPayload: string;
  willQos: string;
  willRetain: string;
  tlsCaCert: string;
  clientCert: string;
  clientKey: string;
  clear: string;
  autoPublish: string;
  publishInterval: string;
  publishCount: string;
  publishCountHint: string;
  startPublish: string;
  stopPublish: string;
  published: string;
  templateTokens: string;
  brokerSys: string;
  sysVersion: string;
  sysUptime: string;
  sysConnections: string;
  sysMsgReceived: string;
  sysMsgSent: string;
  sysLoad: string;
  sysFilter: string;
  sysClear: string;
  sysEmptyWaiting: string;
  sysEmptyOffline: string;
  sysExpandHint: string;
  collapse: string;
  expandAll: string;
  refresh: string;
  modeHistory: string;
  modeHistoryDesc: string;
  historyTitle: string;
  historyRowsUnit: string;
  historyClear: string;
  historyClearConfirm: string;
  historySearchHint: string;
  historyQuery: string;
  historyTrend: string;
  historyAllTopics: string;
  historyNoTrend: string;
  historyWindowTotal: string;
  historyEmpty: string;
  historyAutoRefresh: string;
  historyStatTotal: string;
  historyStatIn: string;
  historyStatOut: string;
  historyStatSpan: string;
  historyPeak: string;
  historyResend: string;
  historySubscribeTopic: string;
  historyFilterByTopic: string;
  historyEmptyTitle: string;
  historyEmptyHint: string;
  historyShowing: string;
  historyBinary: string;
  historyEmptyPayload: string;
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
  dropRelease: string;
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
  modeBridge: string;
  modeBridgeDesc: string;
  modeOps: string;
  modeOpsDesc: string;
  opsTitle: string;
  opsSubtitle: string;
  opsRefresh: string;
  opsCopyReport: string;
  opsCopyFailed: string;
  opsExportReport: string;
  opsCopied: string;
  opsExported: string;
  opsRuntime: string;
  opsBroker: string;
  opsTransferFeed: string;
  opsStorageHistory: string;
  opsBridge: string;
  opsHealthChecks: string;
  opsHealthy: string;
  opsAttention: string;
  opsIssues: string;
  opsHealthScore: string;
  opsErrorsWarnings: string;
  opsLastUpdated: string;
  opsNever: string;
  opsSubscriptions: string;
  opsTrackedTopics: string;
  opsBridgeConnections: string;
  opsEnabledRules: string;
  opsVersion: string;
  opsPlatform: string;
  opsProtocol: string;
  opsTransport: string;
  opsOpenSettings: string;
  opsOpenConsole: string;
  opsOpenHistory: string;
  opsIncoming: string;
  opsOutgoing: string;
  opsBuffered: string;
  opsDropped: string;
  opsHistoryRows: string;
  opsHistoryStore: string;
  opsAvailable: string;
  opsUnavailable: string;
  opsDownloadDir: string;
  opsWritable: string;
  opsReadOnly: string;
  opsBridgeRules: string;
  opsNoSnapshot: string;
  opsTroubleshootingHint: string;
  opsReportHint: string;
  opsCheckDownloadDir: string;
  opsCheckHistory: string;
  opsCheckBroker: string;
  opsCheckTransport: string;
  opsCheckSubscriptions: string;
  opsCheckFeed: string;
  opsCheckTransfers: string;
  opsCheckBridge: string;
  bridgeSource: string;
  bridgeTarget: string;
  currentConfig: string;
  lastUsed: string;
  bridgeAutoReconnect: string;
  customEndpoint: string;
  hostPlaceholder: string;
  portPlaceholder: string;
  bridgeRules: string;
  addRule: string;
  editRule: string;
  saveChanges: string;
  manageConfigs: string;
  ruleDuplicate: string;
  logSummary: string;
  topicFixed: string;
  topicRegex: string;
  fixedTopicPlaceholder: string;
  regexPatternPlaceholder: string;
  regexReplacePlaceholder: string;
  advanced: string;
  excludeTopics: string;
  payloadPrefixPlaceholder: string;
  payloadSuffixPlaceholder: string;
  wrapJson: string;
  rateLimit: string;
  perSec: string;
  dropped: string;
  topicMapMode: string;
  topicMapPlaceholder: string;
  topicMapEmpty: string;
  sourceFiltersMulti: string;
  sourceFilterMultiPlaceholder: string;
  transformScriptLabel: string;
  transformScriptPlaceholder: string;
  insertSample: string;
  scriptHint: string;
  runTest: string;
  testPayloadPlaceholder: string;
  testDropped: string;
  exportRules: string;
  importRules: string;
  importFailed: string;
  quickSubscribe: string;
  replay: string;
  replayTruncated: string;
  topicTraffic: string;
  noTraffic: string;
  msgsPerSec: string;
  totalMsgs: string;
  totalBytes: string;
  peakRate: string;
  lastActive: string;
  trafficMore: string;
  feedDroppedNotice: string;
  actualTopicNote: string;
  trafficCap: string;
  benchLab: string;
  benchTopicPh: string;
  benchRate: string;
  benchSize: string;
  benchDuration: string;
  benchStart: string;
  benchHint: string;
  benchSent: string;
  benchFailed: string;
  capHint: string;
  exportTraffic: string;
  alertSummary: string;
  alertThreshold: string;
  sortBy: string;
  sortRate: string;
  sortPeak: string;
  sortBytes: string;
  sortCount: string;
  snapshotDelta: string;
  snapshotTake: string;
  snapshotClear: string;
  snapshotAge: string;
  deleteRule: string;
  noBridgeRules: string;
  ruleName: string;
  sourceTopicFilter: string;
  topicKeepSame: string;
  topicPrefixMap: string;
  prefixFrom: string;
  prefixTo: string;
  qosFollowSource: string;
  qosFixed: string;
  retainFollow: string;
  retainForceOn: string;
  retainForceOff: string;
  forwardV5Props: string;
  bridgeHint: string;
  forwarded: string;
  bridgeLog: string;
  clearLog: string;
  noBridgeEvents: string;
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
  protocolVersion: string;
  mqttV311: string;
  mqttV5: string;
  cleanSession: string;
  cleanSessionDesc: string;
  autoAcceptFiles: string;
  autoAcceptDesc: string;
  awaitingApproval: string;
  approve: string;
  reject: string;
  sent: string;
  delivered: string;
  clearFinished: string;
  cancelBatch: string;
  payloadFormat: string;
  v5Properties: string;
  contentTypeLabel: string;
  messageExpiryLabel: string;
  responseTopicLabel: string;
  responseTopicHint: string;
  correlationDataLabel: string;
  correlationDataHint: string;
  addProperty: string;
  propertyKey: string;
  propertyValue: string;
  noMessages: string;
  noMessagesFiltered: string;
  truncatedNote: string;
  mdView: string;
  htmlView: string;
  pauseFeed: string;
  resumeFeed: string;
  feedPaused: string;
  flushPending: string;
  preview: string;
  sendHint: string;
  hitTotal: string;
  hitCount: string;
  resetStats: string;
  exportJsonTitle: string;
  exportCsvTitle: string;
  exportDone: string;
  clearRetainedTitle: string;
  retainedOnTopics: string;
  clearAllRetained: string;
  clearingRetained: string;
  retainClearNote: string;
}

export const translations: Record<Language, Translations> = {
  'zh-CN': {
    appName: 'DropQTT',
    tagline: '基于 MQTT 的高可靠跨平台文件传输工具',
    channel: '传输房间频道',
    connected: '已连接',
    disconnected: '未连接',
    disconnect: '断开连接',
    connect: '连接',
    saveAndConnect: '保存并连接',
    cancel: '取消',
    settings: 'MQTT Broker 设置',
    skipToContent: '跳到主要内容',
    brokerConfig: 'MQTT Broker 服务器配置',
    brokerPresets: '常用公共 Broker 预设',
    brokerHost: '服务器地址 / IP',
    port: '端口',
    tls: 'TLS / SSL 安全加密',
    tlsDesc: '使用安全证书加密传输 (例如 8883 端口)',
    advancedConn: '高级连接 (遗嘱消息 / mTLS)',
    transport: '传输协议',
    transportTcp: 'TCP',
    transportWs: 'WebSocket',
    willTopic: '遗嘱主题 (Last Will)',
    willPayload: '遗嘱载荷',
    willQos: '遗嘱 QoS',
    willRetain: '遗嘱保留',
    tlsCaCert: 'CA 证书',
    clientCert: '客户端证书',
    clientKey: '客户端私钥',
    clear: '清除',
    autoPublish: '自动发布',
    publishInterval: '间隔 (秒)',
    publishCount: '次数',
    publishCountHint: '0 = 无限循环直到手动停止',
    startPublish: '开始',
    stopPublish: '停止',
    published: '已发',
    templateTokens: '模板变量',
    brokerSys: 'Broker 监控 ($SYS)',
    sysVersion: '版本',
    sysUptime: '运行时长',
    sysConnections: '连接数',
    sysMsgReceived: '接收消息',
    sysMsgSent: '发送消息',
    sysLoad: '负载',
    sysFilter: '筛选 $SYS 主题…',
    sysClear: '清空指标',
    sysEmptyWaiting: '等待 Broker 上报 $SYS 指标（部分 Broker 需授权后才开放）',
    sysEmptyOffline: '连接后自动采集 Broker 的 $SYS 健康指标',
    sysExpandHint: '展开查看全部 $SYS 指标明细',
    collapse: '收起',
    expandAll: '展开全部',
    refresh: '刷新',
    modeHistory: '报文历史',
    modeHistoryDesc: '全流量留存 · 可检索重发',
    historyTitle: '报文历史检索',
    historyRowsUnit: '条记录',
    historyClear: '清空历史',
    historyClearConfirm: '确定删除所有持久化的报文历史？此操作不可撤销。',
    historySearchHint: '搜索主题或报文正文（回车查询）…',
    historyQuery: '查询',
    historyTrend: '趋势',
    historyAllTopics: '全部主题',
    historyNoTrend: '所选时间范围内无数据',
    historyWindowTotal: '区间总数',
    historyEmpty: '没有匹配的历史记录',
    historyAutoRefresh: '自动刷新',
    historyStatTotal: '总记录',
    historyStatIn: '入站',
    historyStatOut: '出站',
    historyStatSpan: '覆盖时长',
    historyPeak: '峰值',
    historyResend: '重发',
    historySubscribeTopic: '订阅此主题',
    historyFilterByTopic: '按此主题过滤',
    historyEmptyTitle: '暂无历史报文',
    historyEmptyHint: '所有收发的报文都会自动持久化到本地 SQLite（不含分块数据），可跨重启检索、统计与重发。连接并收发消息后即可看到记录。',
    historyShowing: '显示 {count} 条',
    historyBinary: '二进制',
    historyEmptyPayload: '空',
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
    dropRelease: '松手即可加入发送队列',
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
    modeBridge: '数据桥接转发',
    modeBridgeDesc: '两个 Broker 之间按主题规则原样转发消息',
    modeOps: '运维与诊断',
    modeOpsDesc: '健康检查、资源状态与可导出诊断报告',
    opsTitle: '运维诊断中心',
    opsSubtitle: '本地运行快照与主动健康检查；报告不包含密码或证书路径',
    opsRefresh: '刷新',
    opsCopyReport: '复制报告',
    opsCopyFailed: '复制诊断报告失败',
    opsExportReport: '导出报告',
    opsCopied: '诊断报告已复制',
    opsExported: '诊断报告已导出',
    opsRuntime: '运行环境',
    opsBroker: 'Broker 连接',
    opsTransferFeed: '传输与消息压力',
    opsStorageHistory: '存储与历史',
    opsBridge: '桥接运行状态',
    opsHealthChecks: '健康检查',
    opsHealthy: '正常',
    opsAttention: '注意',
    opsIssues: '异常',
    opsHealthScore: '错误 / 警告',
    opsErrorsWarnings: '健康检查结果',
    opsLastUpdated: '更新时间',
    opsNever: '尚未采样',
    opsSubscriptions: '订阅数',
    opsTrackedTopics: '跟踪主题',
    opsBridgeConnections: '桥接连接',
    opsEnabledRules: '启用规则',
    opsVersion: '版本',
    opsPlatform: '平台',
    opsProtocol: '协议',
    opsTransport: '传输',
    opsOpenSettings: '设置',
    opsOpenConsole: '控制台',
    opsOpenHistory: '历史',
    opsIncoming: '接收活动',
    opsOutgoing: '发送活动',
    opsBuffered: 'Feed 缓冲',
    opsDropped: 'Feed 丢弃',
    opsHistoryRows: '历史记录',
    opsHistoryStore: '历史数据库',
    opsAvailable: '可用',
    opsUnavailable: '不可用',
    opsDownloadDir: '下载目录',
    opsWritable: '可写',
    opsReadOnly: '不可写',
    opsBridgeRules: '桥接规则',
    opsNoSnapshot: '正在采集运行状态…',
    opsTroubleshootingHint: '故障排查建议',
    opsReportHint: '先查看异常检查项，再复制或导出报告。报告已脱敏，可安全附到 Issue 或发给维护者。',
    opsCheckDownloadDir: '下载目录可写',
    opsCheckHistory: '历史数据库',
    opsCheckBroker: 'Broker 连通性',
    opsCheckTransport: '传输加密',
    opsCheckSubscriptions: '订阅注册',
    opsCheckFeed: 'Feed 背压',
    opsCheckTransfers: '传输活动',
    opsCheckBridge: '桥接健康度',
    bridgeSource: '转发源',
    bridgeTarget: '转发目标',
    currentConfig: '当前会话配置',
    lastUsed: '上次连接',
    bridgeAutoReconnect: '启动时自动重连',
    customEndpoint: '手动指定 Broker…',
    hostPlaceholder: '主机 (IP / 域名)',
    portPlaceholder: '端口',
    bridgeRules: '转发规则',
    addRule: '添加规则',
    editRule: '编辑规则',
    saveChanges: '保存修改',
    manageConfigs: '管理配置',
    ruleDuplicate: '与规则「{name}」的源过滤器+目标完全重复，请换主题过滤器或目标连接',
    logSummary: '累计转发 {sent} 条 · 缓存 {kept}/{cap} 条 · 显示最新 {shown}',
    topicFixed: '固定目标主题（聚合）',
    topicRegex: '正则捕获替换',
    fixedTopicPlaceholder: '固定主题 (如 all/aggregate)',
    regexPatternPlaceholder: '正则 (如 sensor/(\\w+)/data)',
    regexReplacePlaceholder: '替换 (如 up.$1)',
    advanced: '高级选项',
    excludeTopics: '排除主题过滤器（每行一条，支持通配符）',
    payloadPrefixPlaceholder: '载荷前缀文本 (如 [bridge] )',
    payloadSuffixPlaceholder: '载荷后缀文本 (如 \\n)',
    wrapJson: '包成 JSON 信封',
    rateLimit: '限速',
    perSec: '条/秒',
    dropped: '被排除/限流丢弃',
    topicMapMode: '映射表（逐主题改写）',
    topicMapPlaceholder: '每行一条：/device/2 => /device/20，支持通配符行 legacy/# => modern/all',
    topicMapEmpty: '映射表至少需要一行有效的“from => to”',
    sourceFiltersMulti: '支持多行：每行一个主题过滤器，一条规则订阅多个主题',
    sourceFilterMultiPlaceholder: '主题过滤器，可多行（每行一个）…\n例: sensor/+/data\n例: /device/2',
    transformScriptLabel: 'JS 转换脚本 transform(topic, payload, qos, retain)',
    transformScriptPlaceholder: 'function transform(topic, payload, qos, retain) {\n  return payload;\n}',
    insertSample: '插入示例',
    scriptHint: '返回值即新载荷；返回 null 丢弃消息；超时 100ms / 内存 4MB 限制',
    runTest: '试运行',
    testPayloadPlaceholder: '示例载荷，如 {"temp":23.5}',
    testDropped: '消息被脚本丢弃（返回 null）',
    exportRules: '导出规则',
    importRules: '导入规则',
    importFailed: '导入失败：文件不是有效的桥接规则 JSON',
    quickSubscribe: '点击订阅此主题',
    replay: '重发此消息',
    replayTruncated: '载荷被截断，无法原样重发',
    topicTraffic: '主题流量统计',
    noTraffic: '暂无流量数据 — 订阅主题收到消息后实时统计，最热主题排首位',
    msgsPerSec: '速率',
    totalMsgs: '消息数',
    totalBytes: '数据量',
    peakRate: '峰值',
    lastActive: '最后活跃',
    trafficMore: '另有 {n} 个低频主题未显示',
    feedDroppedNotice: '高吞吐：报文展示已丢弃 {n} 条旧消息（流量统计仍精确）',
    actualTopicNote: '按实际到达主题统计，非通配符过滤器',
    trafficCap: '主题数已达 1000 上限，新主题不再统计',
    benchLab: '压测台',
    benchTopicPh: '压测主题 (回环计入自己的订阅统计)',
    benchRate: '速率/s',
    benchSize: '字节',
    benchDuration: '秒',
    benchStart: '开始压测',
    benchHint: '向本地 broker 发布高压流量，验证统计精度与界面流畅度',
    benchSent: '已发送',
    benchFailed: '启动失败：检查连接状态',
    capHint: '主题跟踪上限（满时自动驱逐最久不活跃主题）',
    exportTraffic: '导出流量表 CSV',
    alertSummary: '发现 {n} 个异常快 topic（≥{x}/s）：',
    alertThreshold: '告警阈值',
    sortBy: '排序维度',
    sortRate: '速率',
    sortPeak: '峰值',
    sortBytes: '数据量',
    sortCount: '消息数',
    snapshotDelta: 'Δ 快照以来',
    snapshotTake: '打快照（对比谁在猛发）',
    snapshotClear: '清除快照',
    snapshotAge: '快照已 {s}s',
    deleteRule: '删除规则',
    noBridgeRules: '暂无规则 — 点击"添加规则"开始配置转发链路',
    ruleName: '规则名称 (例如: 传感器上云)',
    sourceTopicFilter: '源主题过滤器 (支持 + / # 通配符, 如 sensor/+/data)',
    topicKeepSame: '保持原主题',
    topicPrefixMap: '前缀替换',
    prefixFrom: '原前缀 (如 home/bedroom)',
    prefixTo: '新前缀 (如 cloud/uplink)',
    qosFollowSource: '跟随源 QoS',
    qosFixed: '固定 QoS',
    retainFollow: 'Retain 跟随源',
    retainForceOn: 'Retain 强制开',
    retainForceOff: 'Retain 强制关',
    forwardV5Props: '转发 v5 属性',
    bridgeHint: '消息载荷原样转发；源与目标需为不同连接',
    forwarded: '已转发',
    bridgeLog: '转发明细',
    clearLog: '清空日志',
    noBridgeEvents: '暂无转发事件 — 连接源/目标并开始发布后这里会实时滚动',
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
    protocolVersion: 'MQTT 协议版本',
    mqttV311: 'MQTT v3.1.1',
    mqttV5: 'MQTT v5.0',
    cleanSession: 'Clean Session / Clean Start',
    cleanSessionDesc: '关闭后 Broker 将保留会话与订阅（断线重连自动恢复）',
    autoAcceptFiles: '自动接收文件',
    autoAcceptDesc: '关闭后收到的文件需手动点击确认才会落盘保存',
    awaitingApproval: '待确认接收',
    approve: '接收保存',
    reject: '拒绝',
    sent: '已发送·待对端确认',
    delivered: '对端已确认接收',
    clearFinished: '清除已结束',
    cancelBatch: '终止批次',
    payloadFormat: '编码格式',
    v5Properties: 'MQTT v5 报文属性',
    contentTypeLabel: 'Content-Type',
    messageExpiryLabel: '过期时间 (秒)',
    responseTopicLabel: '响应主题 (Response Topic)',
    responseTopicHint: 'RPC 请求：应答发到此主题',
    correlationDataLabel: '关联数据 (Correlation Data)',
    correlationDataHint: 'RPC 请求：应答会原样带回此值以匹配请求',
    addProperty: '添加属性',
    propertyKey: '键',
    propertyValue: '值',
    noMessages: '暂无 MQTT 报文记录',
    noMessagesFiltered: '没有匹配当前筛选的报文',
    truncatedNote: '载荷过大，已截断显示',
    mdView: 'Markdown 渲染视图',
    htmlView: 'HTML 沙箱预览（脚本已禁用）',
    pauseFeed: '暂停接收',
    resumeFeed: '继续接收',
    feedPaused: '消息流已冻结 — 新报文暂存缓冲区',
    flushPending: '释放 {count} 条缓存消息',
    preview: '预览',
    sendHint: '⌘/Ctrl + Enter 发送',
    hitTotal: '共 {count} 次命中',
    hitCount: '该过滤器匹配到的入站消息数',
    resetStats: '重置统计',
    exportJsonTitle: '导出消息为 JSON',
    exportCsvTitle: '导出消息为 CSV',
    exportDone: '已导出 {count} 条消息',
    clearRetainedTitle: '保留消息管理',
    retainedOnTopics: '以下主题存在保留消息',
    clearAllRetained: '清除 {count} 个主题的保留消息',
    clearingRetained: '清除中…',
    retainClearNote: '向每个主题发布空载荷（retain=1）以清除 broker 保留状态',
  },
  'en': {
    appName: 'DropQTT',
    tagline: 'High-speed Resilient File Transfer Over MQTT',
    channel: 'Room Channel',
    connected: 'Connected',
    disconnected: 'Disconnected',
    disconnect: 'Disconnect',
    connect: 'Connect',
    saveAndConnect: 'Save & Connect',
    cancel: 'Cancel',
    settings: 'MQTT Broker Settings',
    skipToContent: 'Skip to main content',
    brokerConfig: 'MQTT Broker Configuration',
    brokerPresets: 'Public Broker Presets',
    brokerHost: 'Broker Host / IP',
    port: 'Port',
    tls: 'TLS / SSL Encryption',
    tlsDesc: 'Encrypted transfer (e.g. port 8883)',
    advancedConn: 'Advanced (Last Will / mTLS)',
    transport: 'Transport',
    transportTcp: 'TCP',
    transportWs: 'WebSocket',
    willTopic: 'Will Topic (Last Will)',
    willPayload: 'Will Payload',
    willQos: 'Will QoS',
    willRetain: 'Will Retain',
    tlsCaCert: 'CA Certificate',
    clientCert: 'Client Cert',
    clientKey: 'Client Key',
    clear: 'Clear',
    autoPublish: 'Auto Publish',
    publishInterval: 'Interval (s)',
    publishCount: 'Count',
    publishCountHint: '0 = loop until stopped',
    startPublish: 'Start',
    stopPublish: 'Stop',
    published: 'Sent',
    templateTokens: 'Tokens',
    brokerSys: 'Broker Monitor ($SYS)',
    sysVersion: 'Version',
    sysUptime: 'Uptime',
    sysConnections: 'Connections',
    sysMsgReceived: 'Msgs Received',
    sysMsgSent: 'Msgs Sent',
    sysLoad: 'Load',
    sysFilter: 'Filter $SYS topics…',
    sysClear: 'Clear metrics',
    sysEmptyWaiting: 'Waiting for broker $SYS metrics (some brokers require authorization)',
    sysEmptyOffline: 'Connect to auto-collect broker $SYS health metrics',
    sysExpandHint: 'Expand to view all $SYS metrics',
    collapse: 'Collapse',
    expandAll: 'Expand all',
    refresh: 'Refresh',
    modeHistory: 'Message History',
    modeHistoryDesc: 'All traffic, searchable',
    historyTitle: 'Message History Search',
    historyRowsUnit: 'rows',
    historyClear: 'Clear history',
    historyClearConfirm: 'Delete all persisted message history? This cannot be undone.',
    historySearchHint: 'Search topic or payload (Enter to query)…',
    historyQuery: 'Query',
    historyTrend: 'Trend',
    historyAllTopics: 'All topics',
    historyNoTrend: 'No data in the selected window',
    historyWindowTotal: 'Window total',
    historyEmpty: 'No matching history records',
    historyAutoRefresh: 'Auto',
    historyStatTotal: 'Total',
    historyStatIn: 'Inbound',
    historyStatOut: 'Outbound',
    historyStatSpan: 'Span',
    historyPeak: 'Peak',
    historyResend: 'Resend',
    historySubscribeTopic: 'Subscribe',
    historyFilterByTopic: 'Filter',
    historyEmptyTitle: 'No history yet',
    historyEmptyHint: 'Every message you send or receive is persisted to a local SQLite store (chunk data excluded) for search, stats and resend across restarts. Connect and exchange messages to populate it.',
    historyShowing: 'Showing {count}',
    historyBinary: 'binary',
    historyEmptyPayload: 'empty',
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
    dropRelease: 'Release to add to the send queue',
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
    modeBridge: 'Data Bridge',
    modeBridgeDesc: 'Forward messages verbatim between two brokers by topic rules',
    modeOps: 'Ops & Diagnostics',
    modeOpsDesc: 'Health checks, resource status and exportable diagnostics',
    opsTitle: 'Operations Diagnostics',
    opsSubtitle: 'Local runtime snapshot and active checks; reports exclude passwords and certificate paths',
    opsRefresh: 'Refresh',
    opsCopyReport: 'Copy report',
    opsCopyFailed: 'Failed to copy diagnostics report',
    opsExportReport: 'Export report',
    opsCopied: 'Diagnostics report copied',
    opsExported: 'Diagnostics report exported',
    opsRuntime: 'Runtime',
    opsBroker: 'Broker Connection',
    opsTransferFeed: 'Transfer & Feed Pressure',
    opsStorageHistory: 'Storage & History',
    opsBridge: 'Bridge Health',
    opsHealthChecks: 'Health Checks',
    opsHealthy: 'Healthy',
    opsAttention: 'Attention',
    opsIssues: 'Issues',
    opsHealthScore: 'Errors / Warnings',
    opsErrorsWarnings: 'check results',
    opsLastUpdated: 'Updated',
    opsNever: 'Not sampled',
    opsSubscriptions: 'Subscriptions',
    opsTrackedTopics: 'tracked topics',
    opsBridgeConnections: 'Bridge connections',
    opsEnabledRules: 'enabled rules',
    opsVersion: 'Version',
    opsPlatform: 'Platform',
    opsProtocol: 'Protocol',
    opsTransport: 'Transport',
    opsOpenSettings: 'Settings',
    opsOpenConsole: 'Console',
    opsOpenHistory: 'History',
    opsIncoming: 'Inbound active',
    opsOutgoing: 'Outbound active',
    opsBuffered: 'Feed buffered',
    opsDropped: 'Feed dropped',
    opsHistoryRows: 'History rows',
    opsHistoryStore: 'History store',
    opsAvailable: 'Available',
    opsUnavailable: 'Unavailable',
    opsDownloadDir: 'Download directory',
    opsWritable: 'Writable',
    opsReadOnly: 'Not writable',
    opsBridgeRules: 'Bridge rules',
    opsNoSnapshot: 'Collecting runtime state…',
    opsTroubleshootingHint: 'Troubleshooting guidance',
    opsReportHint: 'Inspect failing checks first, then copy or export the report. The report is sanitized for Issues and support handoff.',
    opsCheckDownloadDir: 'Download directory writable',
    opsCheckHistory: 'History database',
    opsCheckBroker: 'Broker connectivity',
    opsCheckTransport: 'Transport encryption',
    opsCheckSubscriptions: 'Subscription registry',
    opsCheckFeed: 'Feed backpressure',
    opsCheckTransfers: 'Transfer activity',
    opsCheckBridge: 'Bridge health',
    bridgeSource: 'Source',
    bridgeTarget: 'Target',
    currentConfig: 'Current session',
    lastUsed: 'Last used',
    bridgeAutoReconnect: 'Auto-reconnect on startup',
    customEndpoint: 'Custom broker endpoint…',
    hostPlaceholder: 'Host (IP / domain)',
    portPlaceholder: 'Port',
    bridgeRules: 'Forwarding Rules',
    addRule: 'Add Rule',
    editRule: 'Edit rule',
    saveChanges: 'Save changes',
    manageConfigs: 'Manage configs',
    ruleDuplicate: 'Duplicates rule "{name}" (same filter + target) — change the filter or target connection',
    logSummary: 'total {sent} forwarded · buffer {kept}/{cap} · showing {shown}',
    topicFixed: 'Fixed target topic (aggregate)',
    topicRegex: 'Regex rewrite',
    fixedTopicPlaceholder: 'Fixed topic (e.g. all/aggregate)',
    regexPatternPlaceholder: 'Regex (e.g. sensor/(\\w+)/data)',
    regexReplacePlaceholder: 'Replacement (e.g. up.$1)',
    advanced: 'Advanced',
    excludeTopics: 'Excluded topic filters (one per line, wildcards ok)',
    payloadPrefixPlaceholder: 'Payload prefix (e.g. [bridge] )',
    payloadSuffixPlaceholder: 'Payload suffix (e.g. \\n)',
    wrapJson: 'Wrap in JSON envelope',
    rateLimit: 'Rate limit',
    perSec: 'msgs/sec',
    dropped: 'Dropped by exclusion / rate limit',
    topicMapMode: 'Mapping table (per-topic rewrite)',
    topicMapPlaceholder: 'One row per line: /device/2 => /device/20, wildcard rows like legacy/# => modern/all',
    topicMapEmpty: 'Mapping table needs at least one valid "from => to" row',
    sourceFiltersMulti: 'Multiple lines supported: one topic filter per line, a single rule subscribes to many topics',
    sourceFilterMultiPlaceholder: 'Topic filters, one per line…\ne.g. sensor/+/data\ne.g. /device/2',
    transformScriptLabel: 'JS transform script transform(topic, payload, qos, retain)',
    transformScriptPlaceholder: 'function transform(topic, payload, qos, retain) {\n  return payload;\n}',
    insertSample: 'Insert sample',
    scriptHint: 'Return value becomes the payload; returning null drops the message; 100ms / 4MB sandbox limits',
    runTest: 'Run test',
    testPayloadPlaceholder: 'Sample payload, e.g. {"temp":23.5}',
    testDropped: 'message dropped by script (returned null)',
    exportRules: 'Export rules',
    importRules: 'Import rules',
    importFailed: 'Import failed: not a valid bridge rules JSON',
    quickSubscribe: 'Click to subscribe this topic',
    replay: 'Replay this message',
    replayTruncated: 'Payload truncated — cannot replay verbatim',
    topicTraffic: 'Topic Traffic',
    noTraffic: 'No traffic yet — topics appear here live once messages arrive; hottest first',
    msgsPerSec: 'Rate',
    totalMsgs: 'Msgs',
    totalBytes: 'Volume',
    peakRate: 'Peak',
    lastActive: 'Last active',
    trafficMore: '{n} more low-rate topics hidden',
    feedDroppedNotice: 'High throughput: {n} old messages dropped from feed display (traffic stats remain exact)',
    actualTopicNote: 'Counted per actual arrived topic, not wildcard filter',
    trafficCap: 'Topic tracking hit the 1000 cap — new topics not counted',
    benchLab: 'Bench Lab',
    benchTopicPh: 'Bench topic (loops back into your subscriptions)',
    benchRate: 'rate/s',
    benchSize: 'bytes',
    benchDuration: 'secs',
    benchStart: 'Start bench',
    benchHint: 'Publishes high-rate load to the broker to verify stat accuracy & UI smoothness',
    benchSent: 'sent',
    benchFailed: 'Start failed: check connection',
    capHint: 'Topic tracking cap (LRU-evicts least active when full)',
    exportTraffic: 'Export traffic CSV',
    alertSummary: '{n} anomalously fast topics (≥{x}/s):',
    alertThreshold: 'Alert threshold',
    sortBy: 'Sort by',
    sortRate: 'Rate',
    sortPeak: 'Peak',
    sortBytes: 'Volume',
    sortCount: 'Msgs',
    snapshotDelta: 'Δ since snapshot',
    snapshotTake: 'Take snapshot (find ramp-ups)',
    snapshotClear: 'Clear snapshot',
    snapshotAge: 'snapshot {s}s old',
    deleteRule: 'Delete rule',
    noBridgeRules: 'No rules yet — click "Add Rule" to wire up a bridge',
    ruleName: 'Rule name (e.g. Sensors to cloud)',
    sourceTopicFilter: 'Source topic filter (+ / # wildcards, e.g. sensor/+/data)',
    topicKeepSame: 'Keep original topic',
    topicPrefixMap: 'Replace prefix',
    prefixFrom: 'From prefix (e.g. home/bedroom)',
    prefixTo: 'To prefix (e.g. cloud/uplink)',
    qosFollowSource: 'Follow source QoS',
    qosFixed: 'Fixed QoS',
    retainFollow: 'Retain follows source',
    retainForceOn: 'Retain forced on',
    retainForceOff: 'Retain forced off',
    forwardV5Props: 'Forward v5 properties',
    bridgeHint: 'Payloads forwarded verbatim; source & target must differ',
    forwarded: 'sent',
    bridgeLog: 'Forward Log',
    clearLog: 'Clear log',
    noBridgeEvents: 'No events yet — connect source/target and publish to see live traffic',
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
    protocolVersion: 'MQTT Protocol Version',
    mqttV311: 'MQTT v3.1.1',
    mqttV5: 'MQTT v5.0',
    cleanSession: 'Clean Session / Clean Start',
    cleanSessionDesc: 'When off, the broker persists the session & subscriptions (auto-restored on reconnect)',
    autoAcceptFiles: 'Auto-accept Files',
    autoAcceptDesc: 'When off, incoming files require manual approval before being saved',
    awaitingApproval: 'Awaiting Approval',
    approve: 'Accept & Save',
    reject: 'Reject',
    sent: 'Sent · Awaiting Receipt',
    delivered: 'Delivered (peer confirmed)',
    clearFinished: 'Clear Finished',
    cancelBatch: 'Cancel Batch',
    payloadFormat: 'Format',
    v5Properties: 'MQTT v5 Properties',
    contentTypeLabel: 'Content-Type',
    messageExpiryLabel: 'Expiry (seconds)',
    responseTopicLabel: 'Response Topic',
    responseTopicHint: 'RPC request: the reply is published to this topic',
    correlationDataLabel: 'Correlation Data',
    correlationDataHint: 'RPC request: echoed back verbatim in the reply to match it',
    addProperty: 'Add Property',
    propertyKey: 'Key',
    propertyValue: 'Value',
    noMessages: 'No MQTT messages recorded yet.',
    noMessagesFiltered: 'No messages matching current search filter.',
    truncatedNote: 'Payload too large — display truncated',
    mdView: 'Markdown rendered view',
    htmlView: 'HTML sandbox preview (scripts disabled)',
    pauseFeed: 'Pause Feed',
    resumeFeed: 'Resume',
    feedPaused: 'Feed frozen — incoming messages buffered',
    flushPending: 'Flush {count} buffered',
    preview: 'Preview',
    sendHint: '⌘/Ctrl + Enter to send',
    hitTotal: '{count} hits total',
    hitCount: 'Inbound messages matched by this filter',
    resetStats: 'Reset Stats',
    exportJsonTitle: 'Export messages as JSON',
    exportCsvTitle: 'Export messages as CSV',
    exportDone: 'Exported {count} messages',
    clearRetainedTitle: 'Retained message manager',
    retainedOnTopics: 'Retained messages on these topics',
    clearAllRetained: 'Clear retained on {count} topics',
    clearingRetained: 'Clearing…',
    retainClearNote: 'Publishes an empty payload (retain=1) per topic to wipe broker retain state',
  },
  'zh-TW': {
    appName: 'DropQTT',
    tagline: '基於 MQTT 的高可靠跨平台檔案傳輸工具',
    channel: '傳輸房間頻道',
    connected: '已連線',
    disconnected: '未連線',
    disconnect: '斷開連線',
    connect: '連線',
    saveAndConnect: '儲存並連線',
    cancel: '取消',
    settings: 'MQTT Broker 設定',
    skipToContent: '跳至主要內容',
    brokerConfig: 'MQTT Broker 伺服器配置',
    brokerPresets: '常用公共 Broker 預設',
    brokerHost: '伺服器位址 / IP',
    port: '埠號 (Port)',
    tls: 'TLS / SSL 安全加密',
    tlsDesc: '使用安全憑證加密傳輸 (例如 8883 埠)',
    advancedConn: '進階連線 (遗嘱訊息 / mTLS)',
    transport: '傳輸協定',
    transportTcp: 'TCP',
    transportWs: 'WebSocket',
    willTopic: '遗嘱主題 (Last Will)',
    willPayload: '遗嘱載荷',
    willQos: '遗嘱 QoS',
    willRetain: '遗嘱保留',
    tlsCaCert: 'CA 憑證',
    clientCert: '客戶端憑證',
    clientKey: '客戶端私鑰',
    clear: '清除',
    autoPublish: '自動發布',
    publishInterval: '間隔 (秒)',
    publishCount: '次數',
    publishCountHint: '0 = 無限循環直到手動停止',
    startPublish: '開始',
    stopPublish: '停止',
    published: '已發',
    templateTokens: '範本變數',
    brokerSys: 'Broker 監控 ($SYS)',
    sysVersion: '版本',
    sysUptime: '運行時長',
    sysConnections: '連線數',
    sysMsgReceived: '接收訊息',
    sysMsgSent: '發送訊息',
    sysLoad: '負載',
    sysFilter: '篩選 $SYS 主題…',
    sysClear: '清空指標',
    sysEmptyWaiting: '等待 Broker 上報 $SYS 指標（部分 Broker 需授權後才開放）',
    sysEmptyOffline: '連線後自動收集 Broker 的 $SYS 健康指標',
    sysExpandHint: '展開檢視全部 $SYS 指標明細',
    collapse: '收起',
    expandAll: '展開全部',
    refresh: '重新整理',
    modeHistory: '報文歷史',
    modeHistoryDesc: '全流量留存 · 可檢索重送',
    historyTitle: '報文歷史檢索',
    historyRowsUnit: '條記錄',
    historyClear: '清空歷史',
    historyClearConfirm: '確定刪除所有持久化的報文歷史？此操作無法復原。',
    historySearchHint: '搜尋主題或報文正文（Enter 查詢）…',
    historyQuery: '查詢',
    historyTrend: '趨勢',
    historyAllTopics: '全部主題',
    historyNoTrend: '所選時間範圍內無資料',
    historyWindowTotal: '區間總數',
    historyEmpty: '沒有相符的歷史記錄',
    historyAutoRefresh: '自動更新',
    historyStatTotal: '總記錄',
    historyStatIn: '入站',
    historyStatOut: '出站',
    historyStatSpan: '涵蓋時間',
    historyPeak: '峰值',
    historyResend: '重送',
    historySubscribeTopic: '訂閱此主題',
    historyFilterByTopic: '依此主題過濾',
    historyEmptyTitle: '尚無歷史報文',
    historyEmptyHint: '所有收發的報文都會自動持久化到本機 SQLite（不含分塊資料），可跨重啟檢索、統計與重送。連線並收發訊息後即可看到記錄。',
    historyShowing: '顯示 {count} 條',
    historyBinary: '二進位',
    historyEmptyPayload: '空',
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
    dropRelease: '放開即可加入傳送佇列',
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
    modeBridge: '資料橋接轉發',
    modeBridgeDesc: '兩個 Broker 之間依主題規則原樣轉發訊息',
    modeOps: '維運與診斷',
    modeOpsDesc: '健康檢查、資源狀態與可匯出診斷報告',
    opsTitle: '維運診斷中心',
    opsSubtitle: '本機執行快照與主動健康檢查；報告不含密碼或憑證路徑',
    opsRefresh: '重新整理',
    opsCopyReport: '複製報告',
    opsCopyFailed: '複製診斷報告失敗',
    opsExportReport: '匯出報告',
    opsCopied: '診斷報告已複製',
    opsExported: '診斷報告已匯出',
    opsRuntime: '執行環境',
    opsBroker: 'Broker 連線',
    opsTransferFeed: '傳輸與訊息壓力',
    opsStorageHistory: '儲存與歷史',
    opsBridge: '橋接執行狀態',
    opsHealthChecks: '健康檢查',
    opsHealthy: '正常',
    opsAttention: '注意',
    opsIssues: '異常',
    opsHealthScore: '錯誤 / 警告',
    opsErrorsWarnings: '健康檢查結果',
    opsLastUpdated: '更新時間',
    opsNever: '尚未取樣',
    opsSubscriptions: '訂閱數',
    opsTrackedTopics: '追蹤主題',
    opsBridgeConnections: '橋接連線',
    opsEnabledRules: '啟用規則',
    opsVersion: '版本',
    opsPlatform: '平台',
    opsProtocol: '協定',
    opsTransport: '傳輸',
    opsOpenSettings: '設定',
    opsOpenConsole: '控制台',
    opsOpenHistory: '歷史',
    opsIncoming: '接收活動',
    opsOutgoing: '發送活動',
    opsBuffered: 'Feed 緩衝',
    opsDropped: 'Feed 丟棄',
    opsHistoryRows: '歷史記錄',
    opsHistoryStore: '歷史資料庫',
    opsAvailable: '可用',
    opsUnavailable: '不可用',
    opsDownloadDir: '下載目錄',
    opsWritable: '可寫',
    opsReadOnly: '不可寫',
    opsBridgeRules: '橋接規則',
    opsNoSnapshot: '正在收集執行狀態…',
    opsTroubleshootingHint: '故障排查建議',
    opsReportHint: '先查看異常檢查項，再複製或匯出報告。報告已脫敏，可安全附到 Issue 或交給維護者。',
    opsCheckDownloadDir: '下載目錄可寫',
    opsCheckHistory: '歷史資料庫',
    opsCheckBroker: 'Broker 連線',
    opsCheckTransport: '傳輸加密',
    opsCheckSubscriptions: '訂閱註冊',
    opsCheckFeed: 'Feed 背壓',
    opsCheckTransfers: '傳輸活動',
    opsCheckBridge: '橋接健康度',
    bridgeSource: '轉發來源',
    bridgeTarget: '轉發目標',
    currentConfig: '目前工作階段設定',
    lastUsed: '上次連線',
    bridgeAutoReconnect: '啟動時自動重連',
    customEndpoint: '手動指定 Broker…',
    hostPlaceholder: '主機 (IP / 網域)',
    portPlaceholder: '埠號',
    bridgeRules: '轉發規則',
    addRule: '新增規則',
    editRule: '編輯規則',
    saveChanges: '儲存變更',
    manageConfigs: '管理設定',
    ruleDuplicate: '與規則「{name}」的來源過濾器+目標完全重複，請更換過濾器或目標連線',
    logSummary: '累計轉發 {sent} 則 · 快取 {kept}/{cap} 則 · 顯示最新 {shown}',
    topicFixed: '固定目標主題（聚合）',
    topicRegex: '正則捕獲替換',
    fixedTopicPlaceholder: '固定主題 (如 all/aggregate)',
    regexPatternPlaceholder: '正則 (如 sensor/(\\w+)/data)',
    regexReplacePlaceholder: '替換 (如 up.$1)',
    advanced: '進階選項',
    excludeTopics: '排除主題過濾器（每行一條，支援萬用字元）',
    payloadPrefixPlaceholder: '載入前綴文字 (如 [bridge] )',
    payloadSuffixPlaceholder: '載入後綴文字 (如 \\n)',
    wrapJson: '包成 JSON 信封',
    rateLimit: '限速',
    perSec: '則/秒',
    dropped: '被排除/限流丟棄',
    topicMapMode: '對應表（逐主題改寫）',
    topicMapPlaceholder: '每行一條：/device/2 => /device/20，支援萬用字元行 legacy/# => modern/all',
    topicMapEmpty: '對應表至少需要一行有效的「from => to」',
    sourceFiltersMulti: '支援多行：每行一個主題過濾器，一條規則訂閱多個主題',
    sourceFilterMultiPlaceholder: '主題過濾器，可多行（每行一個）…\n例: sensor/+/data\n例: /device/2',
    transformScriptLabel: 'JS 轉換腳本 transform(topic, payload, qos, retain)',
    transformScriptPlaceholder: 'function transform(topic, payload, qos, retain) {\n  return payload;\n}',
    insertSample: '插入範例',
    scriptHint: '回傳值即新載入；回傳 null 丟棄訊息；100ms / 4MB 沙箱限制',
    runTest: '試運行',
    testPayloadPlaceholder: '範例載入，如 {"temp":23.5}',
    testDropped: '訊息被腳本丟棄（回傳 null）',
    exportRules: '匯出規則',
    importRules: '匯入規則',
    importFailed: '匯入失敗：檔案不是有效的橋接規則 JSON',
    quickSubscribe: '點擊訂閱此主題',
    replay: '重發此訊息',
    replayTruncated: '載入已截斷，無法原樣重發',
    topicTraffic: '主題流量統計',
    noTraffic: '暫無流量資料 — 訂閱主題收到訊息後即時統計，最熱主題排首位',
    msgsPerSec: '速率',
    totalMsgs: '訊息數',
    totalBytes: '資料量',
    peakRate: '峰值',
    lastActive: '最後活躍',
    trafficMore: '另有 {n} 個低頻主題未顯示',
    feedDroppedNotice: '高吞吐：報文展示已丟棄 {n} 條舊訊息（流量統計仍精確）',
    actualTopicNote: '按實際到達主題統計，非萬用字元過濾器',
    trafficCap: '主題數已達 1000 上限，新主題不再統計',
    benchLab: '壓測台',
    benchTopicPh: '壓測主題（回環計入自己的訂閱統計）',
    benchRate: '速率/s',
    benchSize: '位元組',
    benchDuration: '秒',
    benchStart: '開始壓測',
    benchHint: '向本地 broker 發布高壓流量，驗證統計精度與介面流暢度',
    benchSent: '已發送',
    benchFailed: '啟動失敗：檢查連線狀態',
    capHint: '主題追蹤上限（滿時自動驅逐最久不活躍主題）',
    exportTraffic: '匯出流量表 CSV',
    alertSummary: '發現 {n} 個異常快 topic（≥{x}/s）：',
    alertThreshold: '告警閾值',
    sortBy: '排序維度',
    sortRate: '速率',
    sortPeak: '峰值',
    sortBytes: '資料量',
    sortCount: '訊息數',
    snapshotDelta: 'Δ 快照以來',
    snapshotTake: '打快照（對比誰在猛發）',
    snapshotClear: '清除快照',
    snapshotAge: '快照已 {s}s',
    deleteRule: '刪除規則',
    noBridgeRules: '尚無規則 — 點擊「新增規則」開始配置轉發鏈路',
    ruleName: '規則名稱 (例如: 感測器上雲)',
    sourceTopicFilter: '來源主題過濾器 (支援 + / # 萬用字元, 如 sensor/+/data)',
    topicKeepSame: '保持原主題',
    topicPrefixMap: '前綴替換',
    prefixFrom: '原前綴 (如 home/bedroom)',
    prefixTo: '新前綴 (如 cloud/uplink)',
    qosFollowSource: '跟隨來源 QoS',
    qosFixed: '固定 QoS',
    retainFollow: 'Retain 跟隨來源',
    retainForceOn: 'Retain 強制開',
    retainForceOff: 'Retain 強制關',
    forwardV5Props: '轉發 v5 屬性',
    bridgeHint: '訊息載入原樣轉發；來源與目標須為不同連線',
    forwarded: '已轉發',
    bridgeLog: '轉發明細',
    clearLog: '清空日誌',
    noBridgeEvents: '尚無轉發事件 — 連線來源/目標並開始發佈後會即時捲動',
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
    protocolVersion: 'MQTT 協議版本',
    mqttV311: 'MQTT v3.1.1',
    mqttV5: 'MQTT v5.0',
    cleanSession: 'Clean Session / Clean Start',
    cleanSessionDesc: '關閉後 Broker 將保留會話與訂閱（斷線重連自動恢復）',
    autoAcceptFiles: '自動接收檔案',
    autoAcceptDesc: '關閉後收到的檔案需手動點擊確認才會落盤儲存',
    awaitingApproval: '待確認接收',
    approve: '接收儲存',
    reject: '拒絕',
    sent: '已發送·待對端確認',
    delivered: '對端已確認接收',
    clearFinished: '清除已結束',
    cancelBatch: '終止批次',
    payloadFormat: '編碼格式',
    v5Properties: 'MQTT v5 報文屬性',
    contentTypeLabel: 'Content-Type',
    messageExpiryLabel: '過期時間 (秒)',
    responseTopicLabel: '回應主題 (Response Topic)',
    responseTopicHint: 'RPC 請求：應答發布到此主題',
    correlationDataLabel: '關聯資料 (Correlation Data)',
    correlationDataHint: 'RPC 請求：應答會原樣帶回此值以對應請求',
    addProperty: '新增屬性',
    propertyKey: '鍵',
    propertyValue: '值',
    noMessages: '暫無 MQTT 報文記錄',
    noMessagesFiltered: '沒有符合目前篩選的報文',
    truncatedNote: '載荷過大，已截斷顯示',
    mdView: 'Markdown 渲染視圖',
    htmlView: 'HTML 沙箱預覽（已禁用腳本）',
    pauseFeed: '暫停接收',
    resumeFeed: '繼續接收',
    feedPaused: '訊息流已凍結 — 新報文暫存緩衝區',
    flushPending: '釋放 {count} 條緩衝訊息',
    preview: '預覽',
    sendHint: '⌘/Ctrl + Enter 傳送',
    hitTotal: '共 {count} 次命中',
    hitCount: '此過濾器匹配到的入站訊息數',
    resetStats: '重設統計',
    exportJsonTitle: '匯出訊息為 JSON',
    exportCsvTitle: '匯出訊息為 CSV',
    exportDone: '已匯出 {count} 條訊息',
    clearRetainedTitle: '保留訊息管理',
    retainedOnTopics: '以下主題存在保留訊息',
    clearAllRetained: '清除 {count} 個主題的保留訊息',
    clearingRetained: '清除中…',
    retainClearNote: '向每個主題發布空載荷（retain=1）以清除 broker 保留狀態',
  },
  'ja': {
    appName: 'DropQTT',
    tagline: 'MQTT ベースの耐障害性クロスプラットフォーム ファイル転送ツール',
    channel: 'ルーム チャンネル',
    connected: '接続済み',
    disconnected: '切断',
    disconnect: '接続解除',
    connect: '接続',
    saveAndConnect: '保存して接続',
    cancel: 'キャンセル',
    settings: 'MQTT ブローカー設定',
    skipToContent: 'メインコンテンツへ移動',
    brokerConfig: 'MQTT ブローカー構成',
    brokerPresets: 'パブリック ブローカー プリセット',
    brokerHost: 'ホスト / IP',
    port: 'ポート',
    tls: 'TLS / SSL 暗号化',
    tlsDesc: 'セキュア暗号化転送 (例: ポート 8883)',
    advancedConn: '詳細接続 (Last Will / mTLS)',
    transport: 'トランスポート',
    transportTcp: 'TCP',
    transportWs: 'WebSocket',
    willTopic: 'Will トピック (Last Will)',
    willPayload: 'Will ペイロード',
    willQos: 'Will QoS',
    willRetain: 'Will 保持',
    tlsCaCert: 'CA 証明書',
    clientCert: 'クライアント証明書',
    clientKey: 'クライアント秘密鍵',
    clear: 'クリア',
    autoPublish: '自動発行',
    publishInterval: '間隔 (秒)',
    publishCount: '回数',
    publishCountHint: '0 = 手動停止までループ',
    startPublish: '開始',
    stopPublish: '停止',
    published: '送信済',
    templateTokens: 'テンプレート変数',
    brokerSys: 'Broker モニタ ($SYS)',
    sysVersion: 'バージョン',
    sysUptime: '稼働時間',
    sysConnections: '接続数',
    sysMsgReceived: '受信メッセージ',
    sysMsgSent: '送信メッセージ',
    sysLoad: '負荷',
    sysFilter: '$SYS トピックを絞り込み…',
    sysClear: '指標をクリア',
    sysEmptyWaiting: 'Broker の $SYS 指標を待機中（認可が必要な Broker があります）',
    sysEmptyOffline: '接続すると Broker の $SYS 指標を自動収集',
    sysExpandHint: '展開して全ての $SYS 指標を表示',
    collapse: '折りたたむ',
    expandAll: '全て展開',
    refresh: '更新',
    modeHistory: 'メッセージ履歴',
    modeHistoryDesc: '全トラフィック保存 · 検索・再送可',
    historyTitle: 'メッセージ履歴検索',
    historyRowsUnit: '件',
    historyClear: '履歴を消去',
    historyClearConfirm: '保存された全メッセージ履歴を削除しますか？元に戻せません。',
    historySearchHint: 'トピックまたは本文を検索（Enter で実行）…',
    historyQuery: '実行',
    historyTrend: 'トレンド',
    historyAllTopics: '全トピック',
    historyNoTrend: '選択範囲にデータがありません',
    historyWindowTotal: '期間合計',
    historyEmpty: '一致する履歴がありません',
    historyAutoRefresh: '自動更新',
    historyStatTotal: '総件数',
    historyStatIn: '受信',
    historyStatOut: '送信',
    historyStatSpan: '期間',
    historyPeak: 'ピーク',
    historyResend: '再送',
    historySubscribeTopic: '購読',
    historyFilterByTopic: '絞り込み',
    historyEmptyTitle: '履歴はまだありません',
    historyEmptyHint: '送受信したメッセージはすべてローカルの SQLite に自動永続化（チャンクデータ除く）され、再起動後も検索・統計・再送が可能です。接続してメッセージをやり取りすると記録が表示されます。',
    historyShowing: '{count} 件を表示',
    historyBinary: 'バイナリ',
    historyEmptyPayload: '空',
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
    dropRelease: '離すと送信キューに追加されます',
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
    modeMqttClientDesc: '汎用 MQTT トピック購読・パブリッシュおよびライブス トリーム検査',
    modeBridge: 'データブリッジ転送',
    modeBridgeDesc: '2つのBroker間をトピックルールでそのまま転送',
    modeOps: '運用・診断',
    modeOpsDesc: 'ヘルスチェック、リソース状態、診断レポート',
    opsTitle: '運用診断センター',
    opsSubtitle: 'ローカル実行スナップショットと能動チェック。パスワードや証明書パスは含みません',
    opsRefresh: '更新',
    opsCopyReport: 'レポートをコピー',
    opsCopyFailed: '診断レポートのコピーに失敗しました',
    opsExportReport: 'レポートを書き出す',
    opsCopied: '診断レポートをコピーしました',
    opsExported: '診断レポートを書き出しました',
    opsRuntime: '実行環境',
    opsBroker: 'Broker 接続',
    opsTransferFeed: '転送とメッセージ負荷',
    opsStorageHistory: 'ストレージと履歴',
    opsBridge: 'ブリッジ状態',
    opsHealthChecks: 'ヘルスチェック',
    opsHealthy: '正常',
    opsAttention: '注意',
    opsIssues: '異常',
    opsHealthScore: 'エラー / 警告',
    opsErrorsWarnings: 'チェック結果',
    opsLastUpdated: '更新時刻',
    opsNever: '未取得',
    opsSubscriptions: '購読数',
    opsTrackedTopics: '追跡トピック',
    opsBridgeConnections: 'ブリッジ接続',
    opsEnabledRules: '有効ルール',
    opsVersion: 'バージョン',
    opsPlatform: 'プラットフォーム',
    opsProtocol: 'プロトコル',
    opsTransport: 'トランスポート',
    opsOpenSettings: '設定',
    opsOpenConsole: 'コンソール',
    opsOpenHistory: '履歴',
    opsIncoming: '受信アクティブ',
    opsOutgoing: '送信アクティブ',
    opsBuffered: 'Feed バッファ',
    opsDropped: 'Feed 破棄',
    opsHistoryRows: '履歴件数',
    opsHistoryStore: '履歴 DB',
    opsAvailable: '利用可能',
    opsUnavailable: '利用不可',
    opsDownloadDir: 'ダウンロード先',
    opsWritable: '書込可能',
    opsReadOnly: '書込不可',
    opsBridgeRules: 'ブリッジルール',
    opsNoSnapshot: '実行状態を収集中…',
    opsTroubleshootingHint: 'トラブルシューティング',
    opsReportHint: '異常項目を確認してからレポートをコピーまたは書き出してください。機密情報は除去済みです。',
    opsCheckDownloadDir: 'ダウンロード先の書込権限',
    opsCheckHistory: '履歴データベース',
    opsCheckBroker: 'Broker 接続性',
    opsCheckTransport: '通信暗号化',
    opsCheckSubscriptions: '購読登録',
    opsCheckFeed: 'Feed バックプレッシャー',
    opsCheckTransfers: '転送アクティビティ',
    opsCheckBridge: 'ブリッジ健全性',
    bridgeSource: '転送ソース',
    bridgeTarget: '転送先',
    currentConfig: '現在のセッション設定',
    lastUsed: '前回接続',
    bridgeAutoReconnect: '起動時に自動再接続',
    customEndpoint: 'ブローカーを手動指定…',
    hostPlaceholder: 'ホスト (IP / ドメイン)',
    portPlaceholder: 'ポート',
    bridgeRules: '転送ルール',
    addRule: 'ルール追加',
    editRule: 'ルール編集',
    saveChanges: '変更を保存',
    manageConfigs: '設定管理',
    ruleDuplicate: 'ルール「{name}」と同じフィルタ+転送先です。フィルタか接続先を変更してください',
    logSummary: '累計 {sent} 件転送 · バッファ {kept}/{cap} · 直近 {shown} 件表示',
    topicFixed: '固定ターゲットトピック（集約）',
    topicRegex: '正規表現書き換え',
    fixedTopicPlaceholder: '固定トピック (例: all/aggregate)',
    regexPatternPlaceholder: '正規表現 (例: sensor/(\\w+)/data)',
    regexReplacePlaceholder: '置換 (例: up.$1)',
    advanced: '詳細オプション',
    excludeTopics: '除外トピックフィルタ（1行1つ、ワイルドカード可）',
    payloadPrefixPlaceholder: 'ペイロード接頭辞 (例: [bridge] )',
    payloadSuffixPlaceholder: 'ペイロード接尾辞 (例: \\n)',
    wrapJson: 'JSON エンベロープ化',
    rateLimit: 'レート制限',
    perSec: '件/秒',
    dropped: '除外/制限で破棄',
    topicMapMode: 'マッピングテーブル（トピック単位書換）',
    topicMapPlaceholder: '1行1件: /device/2 => /device/20、ワイルドカード行 legacy/# => modern/all も可',
    topicMapEmpty: 'マッピングテーブルに有効な「from => to」行が少なくとも1件必要です',
    sourceFiltersMulti: '複数行対応：1行1トピックフィルタで1ルール複数トピック購読',
    sourceFilterMultiPlaceholder: 'トピックフィルタ（1行1件）…\n例: sensor/+/data\n例: /device/2',
    transformScriptLabel: 'JS 変換スクリプト transform(topic, payload, qos, retain)',
    transformScriptPlaceholder: 'function transform(topic, payload, qos, retain) {\n  return payload;\n}',
    insertSample: 'サンプル挿入',
    scriptHint: '戻り値が新しいペイロード；null で破棄；100ms / 4MB サンドボックス制限',
    runTest: 'テスト実行',
    testPayloadPlaceholder: 'サンプルペイロード 例: {"temp":23.5}',
    testDropped: 'スクリプトにより破棄（null 返却）',
    exportRules: 'ルールエクスポート',
    importRules: 'ルールインポート',
    importFailed: 'インポート失敗：有効なブリッジルール JSON ではありません',
    quickSubscribe: 'クリックでこのトピックを購読',
    replay: 'このメッセージを再送',
    replayTruncated: 'ペイロードが切り詰められており再送不可',
    topicTraffic: 'トピックトラフィック統計',
    noTraffic: 'トラフィックなし — メッセージ受信後にリアルタイム集計、最多のトピックが先頭に',
    msgsPerSec: '速度',
    totalMsgs: '件数',
    totalBytes: 'データ量',
    peakRate: 'ピーク',
    lastActive: '最終アクティブ',
    trafficMore: '他 {n} 件の低頻度トピックは非表示',
    feedDroppedNotice: '高スループット：表示から {n} 件の旧メッセージを破棄（トラフィック統計は正確）',
    actualTopicNote: '実際に届いたトピック単位で集計（ワイルドカードではない）',
    trafficCap: 'トピック追跡が 1000 上限に到達 — 新規は非集計',
    benchLab: 'ベンチ台',
    benchTopicPh: 'ベンチトピック（自分の購読にループバック）',
    benchRate: '速度/s',
    benchSize: 'バイト',
    benchDuration: '秒',
    benchStart: 'ベンチ開始',
    benchHint: 'ブローカーへ高負荷送信し統計精度と UI 応答性を検証',
    benchSent: '送信済',
    benchFailed: '開始失敗：接続を確認してください',
    capHint: 'トピック追跡上限（満杯時は最不活性を自動退避）',
    exportTraffic: 'トラフィック CSV エクスポート',
    alertSummary: '異常に速いトピック {n} 件（≥{x}/s）：',
    alertThreshold: '警告しきい値',
    sortBy: 'ソート基準',
    sortRate: '速度',
    sortPeak: 'ピーク',
    sortBytes: 'データ量',
    sortCount: '件数',
    snapshotDelta: 'Δ スナップショット以降',
    snapshotTake: 'スナップショット（急増を発見）',
    snapshotClear: 'スナップショット解除',
    snapshotAge: 'スナップショット {s}s 前',
    deleteRule: 'ルール削除',
    noBridgeRules: 'ルールがありません —「ルール追加」から設定を始めましょう',
    ruleName: 'ルール名 (例: センサー上雲)',
    sourceTopicFilter: 'ソーストピックフィルタ (+ / # ワイルドカード対応, 例: sensor/+/data)',
    topicKeepSame: 'トピックを維持',
    topicPrefixMap: 'プレフィックス置換',
    prefixFrom: '元の接頭辞 (例: home/bedroom)',
    prefixTo: '新しい接頭辞 (例: cloud/uplink)',
    qosFollowSource: 'ソース QoS に追従',
    qosFixed: 'QoS 固定',
    retainFollow: 'Retain はソースに追従',
    retainForceOn: 'Retain 強制オン',
    retainForceOff: 'Retain 強制オフ',
    forwardV5Props: 'v5 プロパティを転送',
    bridgeHint: 'ペイロードはそのまま転送。ソースと転送先は別の接続である必要があります',
    forwarded: '送信済',
    bridgeLog: '転送ログ',
    clearLog: 'ログをクリア',
    noBridgeEvents: '転送イベントはまだありません — 接続して発行するとライブ表示されます',
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
    protocolVersion: 'MQTT プロトコルバージョン',
    mqttV311: 'MQTT v3.1.1',
    mqttV5: 'MQTT v5.0',
    cleanSession: 'Clean Session / Clean Start',
    cleanSessionDesc: 'オフにするとブローカーがセッションと購読を保持（再接続時に自動復元）',
    autoAcceptFiles: 'ファイルを自動受領',
    autoAcceptDesc: 'オフにすると受信ファイルは手動承認まで保存されません',
    awaitingApproval: '受領確認待ち',
    approve: '受領して保存',
    reject: '拒否',
    sent: '送信完了·相手確認待ち',
    delivered: '相手が受領確認',
    clearFinished: '完了分を消去',
    cancelBatch: 'バッチ中止',
    payloadFormat: 'エンコード形式',
    v5Properties: 'MQTT v5 プロパティ',
    contentTypeLabel: 'Content-Type',
    messageExpiryLabel: '有効期限 (秒)',
    responseTopicLabel: 'レスポンストピック (Response Topic)',
    responseTopicHint: 'RPC リクエスト：応答はこのトピックに公開されます',
    correlationDataLabel: '相関データ (Correlation Data)',
    correlationDataHint: 'RPC リクエスト：応答にこの値がそのまま返され対応付けます',
    addProperty: 'プロパティ追加',
    propertyKey: 'キー',
    propertyValue: '値',
    noMessages: 'MQTT メッセージはまだありません',
    noMessagesFiltered: 'フィルターに一致するメッセージがありません',
    truncatedNote: 'ペイロードが大きすぎるため表示を切り詰めました',
    mdView: 'Markdown レンダリング表示',
    htmlView: 'HTML サンドボックスプレビュー（スクリプト無効）',
    pauseFeed: '受信を一時停止',
    resumeFeed: '再開',
    feedPaused: 'フィード凍結中 — 新メッセージはバッファに保留',
    flushPending: '{count} 件の保留を解除',
    preview: 'プレビュー',
    sendHint: '⌘/Ctrl + Enter で送信',
    hitTotal: '合計 {count} ヒット',
    hitCount: 'このフィルタが一致した受信メッセージ数',
    resetStats: '統計リセット',
    exportJsonTitle: 'メッセージを JSON エクスポート',
    exportCsvTitle: 'メッセージを CSV エクスポート',
    exportDone: '{count} 件をエクスポートしました',
    clearRetainedTitle: '保持メッセージ管理',
    retainedOnTopics: 'これらのトピックに保持メッセージがあります',
    clearAllRetained: '{count} トピックの保持を削除',
    clearingRetained: '削除中…',
    retainClearNote: '各トピックに空ペイロード（retain=1）を発行し、ブローカーの保持状態を解除します',
  },
};
