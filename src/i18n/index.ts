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
  publishDevices: string;
  publishDevicesHint: string;
  benchExpectTitle: string;
  benchExpectMinRate: string;
  benchExpectP99: string;
  benchExpectLost: string;
  benchVerdictPass: string;
  benchVerdictFail: string;
  benchVerdictPending: string;
  benchFailMinRate: string;
  benchFailP99: string;
  benchFailLost: string;
  benchFailNoSamples: string;
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
  sysRetained: string;
  sysSubscriptions: string;
  sysBytesIn: string;
  sysBytesOut: string;
  sysNoDialect: string;
  sysUnknownVendor: string;
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
  opsScheduledRuns: string;
  opsBenchRuns: string;
  opsConfirmTimeouts: string;
  opsHistoryLost: string;
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
  opsFeedLost: string;
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
  historyAllTime: string;
  historyPerBucket: string;
  historyExportResults: string;
  integrationRecipes: string;
  recipeTelemetry: string;
  recipeTelemetryHint: string;
  recipeAlert: string;
  recipeAlertHint: string;
  recipeBroker: string;
  recipeBrokerHint: string;
  integrationTarget: string;
  webhookUrl: string;
  webhookBody: string;
  webhookEnvelope: string;
  webhookRaw: string;
  webhookHeaders: string;
  webhookHint: string;
  webhookInvalid: string;
  webhookExportHint: string;
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
  uiCrashedTitle: string;
  uiCrashedHint: string;
  uiCrashedRetry: string;
  codecTitle: string;
  codecHint: string;
  codecClear: string;
  codecOn: string;
  codecOff: string;
  codecFailed: string;
  codecPending: string;
  senmlView: string;
  silenceTitle: string;
  silenceAdd: string;
  silenceHint: string;
  silenceNeedsConnection: string;
  silenceFilter: string;
  silenceTimeout: string;
  silenceCooldown: string;
  silenceNoRules: string;
  silenceAfter: string;
  silenceEvery: string;
  silenceLog: string;
  silenceEmpty: string;
  silenceNeedFields: string;
  silenceMinTimeout: string;
  silenceEnabled: string;
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
  benchStop: string;
  benchAcked: string;
  benchObserved: string;
  benchLatency: string;
  benchClear: string;
  benchDurationHint: string;
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
  subV5Options: string;
  subNoLocalHint: string;
  subRetainAsPublishedHint: string;
  subRetainHandling: string;
  subRetainHandling0: string;
  subRetainHandling1: string;
  subRetainHandling2: string;
  subShareToggle: string;
  subShareGroup: string;
  subShareHint: string;
  subShareChip: string;
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
  confirmTimeout: string;
  resendHint: string;
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
  sessionExpiry: string;
  sessionExpiryHint: string;
  willDelay: string;
  willContentType: string;
  payloadFormatHint: string;
  matchedByBrokerHint: string;
  matchedByLocalHint: string;
  payloadFormatUnset: string;
  topicAliasLabel: string;
  topicAliasHint: string;
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
  subRejectedChip: string;
  subQuarantinedHint: string;
  capQosCeiling: string;
  capRetainOff: string;
  capSharedOff: string;
  capWildcardOff: string;
  capAliasMax: string;
  capPacketSize: string;
  capReceiveMax: string;
  capSessionExpiry: string;
  capServerKeepAlive: string;
  capAssignedClientId: string;
  capResponseInfo: string;
  capServerRef: string;
  opsBrokerCapabilities: string;
  capAnnouncedAfterConnect: string;
  capAvailable: string;
  capUnavailable: string;
  capRowWildcard: string;
  capRowAlias: string;
  capRowReceive: string;
  capRowPacket: string;
  subRejectedToast: string;
  subDowngradedToast: string;
  unsubRejectedToast: string;
  clearRetainFailed: string;
  clearMessagesConfirm: string;
  unsubscribeFailed: string;
  subscribeFailed: string;
  connectFailed: string;
  updateCheckFailed: string;
  subShareGroupRequired: string;
  publishRejectedToast: string;
  publishRejectedManyToast: string;
  opsRejectedSubs: string;
  opsRefusedUnsubs: string;
  opsPublishRejected: string;
  opsAcksUnattributed: string;
  opsFeedFlushMs: string;
  opsFeedLagMs: string;
  opsHistoryWriteMs: string;
  opsCalls: string;
  opsLagHint: string;
  cmpTopic: string;
  cmpDirection: string;
  cmpUserProps: string;
  cmpPayload: string;
  compareToggle: string;
  comparePickTwo: string;
  compareTooLarge: string;
  benchNoSubscribers: string;
  corrHexHint: string;
  corrHexBadge: string;
  rpcNoCorrelation: string;
  ackCodeGrantedQos: string;
  ackCodeUnspecified: string;
  ackCodeImplSpecific: string;
  ackCodeNotAuthorized: string;
  ackCodeTopicFilterInvalid: string;
  ackCodeTopicNameInvalid: string;
  ackCodePkidInUse: string;
  ackCodePkidNotFound: string;
  ackCodeQuotaExceeded: string;
  ackCodeSharedSubsUnsupported: string;
  ackCodeSubIdUnsupported: string;
  ackCodeWildcardSubsUnsupported: string;
  ackCodeNoSubscribers: string;
  ackCodePayloadFormatInvalid: string;
  ackCodeNoSubscriptionExisted: string;
  ackCodeUnrecognized: string;
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
  schedulesTitle: string;
  scheduleNote: string;
  scheduleUnsupported: string;
  scheduleEmpty: string;
  scheduleStopAll: string;
  scheduleRunNow: string;
  scheduleRunDone: string;
  scheduleRunFailed: string;
  scheduleRunStopped: string;
  rpcTitle: string;
  rpcAwaitReply: string;
  rpcTimeoutLabel: string;
  rpcHint: string;
  rpcPending: string;
  rpcResolved: string;
  rpcNoReply: string;
  rpcRoundTrip: string;
  rpcResponseTopicPh: string;
  rpcPairedByPosition: string;
  rpcCorrelationLabel: string;
  rpcReplyBody: string;
  rpcClear: string;
  rpcEmpty: string;
  opsRpcPending: string;
  opsRpcTimeouts: string;
  uiWorkspaceMode: string;
  modeSubTransfer: string;
  modeSubConsole: string;
  modeSubBridge: string;
  btnTemplate: string;
  btnPrettify: string;
  publishingNow: string;
  payloadTruncatedTip: string;
  clickToExpand: string;
  copyBtn: string;
  copiedBtn: string;
  chunkHintIot: string;
  chunkHintRecommended: string;
  chunkHintFast: string;
  chunkHintLan: string;
  chunkHintMax: string;
  brokerUserPh: string;
  subscribeFailedAtConnect: string;
  batchSummaryAll: string;
  batchSummaryPartial: string;
  trafficFilterPh: string;
  deleteConfirmAgain: string;
  testRunning: string;
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
    publishInterval: '间隔 (毫秒)',
    publishCount: '次数',
    publishCountHint: '0 = 无限循环直到手动停止',
    publishDevices: '设备数',
    publishDevicesHint: '每一拍向多少个模拟设备发送（${device} 从 1 到该值轮换）',
    benchExpectTitle: '验收阈值',
    benchExpectMinRate: '最低速率 /s',
    benchExpectP99: '最高 p99 ms',
    benchExpectLost: '最多未确认',
    benchVerdictPass: '通过',
    benchVerdictFail: '未通过',
    benchVerdictPending: '进行中',
    benchFailMinRate: '速率 {actual}/s 低于要求的 {limit}/s',
    benchFailP99: 'p99 {actual} ms 高于要求的 {limit} ms',
    benchFailLost: '{actual} 条未确认，要求不超过 {limit}',
    benchFailNoSamples: '没有回环样本，无法判定 p99',
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
    sysRetained: '保留消息',
    sysSubscriptions: '订阅数',
    sysBytesIn: '接收字节',
    sysBytesOut: '发送字节',
    sysNoDialect: '未识别该 broker 的 $SYS 布局（{vendor}），只显示原始树',
    sysUnknownVendor: '未知厂商',
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
    opsScheduledRuns: '定时发布运行中',
    opsBenchRuns: '压测运行中',
    opsConfirmTimeouts: '对端未确认的发送',
    opsHistoryLost: '未能写入历史',
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
    opsFeedLost: 'Feed 丢失（含历史）',
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
    historyAllTime: "全部时间",
    historyPerBucket: "/ 时间段",
    historyExportResults: "导出当前筛选结果",
    integrationRecipes: "集成场景模板",
    recipeTelemetry: "遥测接入业务 API",
    recipeTelemetryHint: "将设备遥测转成带主题与时间的 JSON 请求。",
    recipeAlert: "温度阈值告警",
    recipeAlertHint: "过滤低于 40°C 的消息，将告警转成 Webhook 请求。",
    recipeBroker: "边缘站点汇聚",
    recipeBrokerHint: "为上行主题添加站点前缀，汇聚到另一台 Broker。",
    integrationTarget: "转发目标",
    webhookUrl: "Webhook 地址",
    webhookBody: "请求体格式",
    webhookEnvelope: "JSON 信封（主题、时间、载荷）",
    webhookRaw: "原始载荷（适配自定义 API）",
    webhookHeaders: "请求头（每行 名称: 值）",
    webhookHint: "仅需连接来源 Broker。最多 4 个 HTTP 请求同时进行，10 秒超时；忙碌或超过 2 MB 的请求计入丢弃，不自动重试。请求头仅保存在本机。",
    webhookInvalid: "请填写有效的 HTTP(S) 地址和请求头；认证请使用请求头。",
    webhookExportHint: "导出 HTTP 规则时会移除地址和请求头，并停用规则；导入后请重新配置。",
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
    uiCrashedTitle: '{area} 渲染失败',
    uiCrashedHint: '该工作区已停止渲染，其余功能与连接不受影响。可重试，或到「运维与诊断」导出诊断报告。',
    uiCrashedRetry: '重试该视图',
    codecTitle: '载荷编解码脚本（仅影响显示）',
    codecHint: 'function transform(topic, payload, qos, retain) 返回要显示的文本。原始报文与历史、导出、重发完全不受影响；抛错的行会保留原文并标红。',
    codecClear: '清除脚本',
    codecOn: '编解码已启用',
    codecOff: '编解码',
    codecFailed: '编解码失败',
    codecPending: '解码中…',
    senmlView: 'SenML 读数表（RFC 8428）',
    silenceTitle: '静默告警',
    silenceAdd: '新建告警',
    silenceHint: '当某个主题过滤器在设定秒数内没有任何消息时，向 Webhook POST 告警；同一次持续离线按冷却时间抑制重复告警，设备恢复上报后计时器自动清零。',
    silenceNeedsConnection: '当前未连接：断开期间不会判为设备静默。',
    silenceFilter: '主题过滤器',
    silenceTimeout: '静默阈值（秒）',
    silenceCooldown: '冷却时间（秒）',
    silenceNoRules: '还没有静默告警规则。',
    silenceAfter: '{n} 秒无消息',
    silenceEvery: '每 {n} 秒最多一次',
    silenceLog: '告警记录',
    silenceEmpty: '暂无告警。',
    silenceNeedFields: '名称与主题过滤器都不能为空。',
    silenceMinTimeout: '静默阈值至少 {n} 秒（最后上报只有 1 秒精度）。',
    silenceEnabled: '启用',
    actualTopicNote: '按实际到达主题统计，非通配符过滤器',
    trafficCap: '主题数已达 1000 上限，新主题不再统计',
    benchLab: '压测台',
    benchTopicPh: '压测主题，逗号或空格分隔 (回环计入自己的订阅统计)',
    benchRate: '速率/s',
    benchSize: '字节',
    benchDuration: '秒',
    benchStart: '开始压测',
    benchHint: '向本地 broker 发布高压流量，验证统计精度与界面流畅度',
    benchSent: '已发送',
    benchFailed: '启动失败：检查连接状态',
    benchStop: '停止',
    benchAcked: '已确认',
    benchObserved: '已采样',
    benchLatency: '回环延迟',
    benchClear: '清除已结束',
    benchDurationHint: '0 = 直到手动停止',
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
    subV5Options: 'MQTT5 订阅选项',
    subNoLocalHint: '不接收自己发布的回环',
    subRetainAsPublishedHint: '转发时保留 RETAIN 标志',
    subRetainHandling: 'Retain Handling',
    subRetainHandling0: '0 · 每次订阅都下发保留消息',
    subRetainHandling1: '1 · 仅新订阅时下发',
    subRetainHandling2: '2 · 从不下发保留消息',
    subShareToggle: '共享订阅',
    subShareGroup: '共享组',
    subShareHint: '同一共享组内的多个实例由 broker 轮流派发，用于消费端水平扩展。组名不能含 / + #，不能与 No Local 同时使用，且只有 MQTT5 有这套机制。',
    subShareChip: '共享组 {name}',
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
    confirmTimeout: '已发送·对端未确认',
    resendHint: '重新发送（作为一笔新传输）',
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
    sessionExpiry: '会话过期 (秒)',
    sessionExpiryHint: 'MQTT5 Session-Expiry-Interval：断线后 broker 保留会话与离线 QoS1/2 消息的时长；留空表示不发该属性',
    willDelay: '遗嘱延迟 (秒)',
    willContentType: '遗嘱 Content-Type',
    payloadFormatHint: 'MQTT5 Payload Format Indicator：0=字节流，1=UTF-8；不设置则不发送该属性',
    payloadFormatUnset: 'PFI · 不设置',
    topicAliasLabel: '主题别名 (Topic Alias)',
    topicAliasHint: 'MQTT5 主题别名按连接有效，且受 broker 在 CONNACK 里通告的 topic-alias-maximum 限制；超出会被拒绝而不是断线。首个带别名的发布必须同时带完整主题',
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
    subRejectedChip: '被拒：{reason}',
    subQuarantinedHint: '在重新订阅前不会重试（被拒的 SUBACK 会中断会话）',
    capQosCeiling: 'broker 最高支持 QoS {n}',
    capRetainOff: '该 broker 不支持 retain（retain-available = 0）',
    capSharedOff: '该 broker 不支持共享订阅',
    capWildcardOff: '该 broker 不支持通配符订阅',
    capAliasMax: '主题别名上限 {n}',
    capPacketSize: '报文上限 {n} B',
    capReceiveMax: '接收上限 {n}',
    capSessionExpiry: '会话过期 {n} s',
    capServerKeepAlive: '服务端 keep-alive {n} s',
    capAssignedClientId: '服务端指派的 clientId',
    capResponseInfo: '响应信息',
    capServerRef: '服务端引用',
    opsBrokerCapabilities: 'broker 通告的能力',
    capAnnouncedAfterConnect: '连接后由 CONNACK 通告',
    capAvailable: '支持',
    capUnavailable: '不支持',
    capRowWildcard: '通配符订阅',
    capRowAlias: '主题别名',
    capRowReceive: '接收上限',
    capRowPacket: '报文大小',
    subRejectedToast: 'broker 拒绝订阅 {topic}：{reason}',
    subDowngradedToast: 'broker 将 {topic} 降为 QoS {qos}',
    unsubRejectedToast: 'broker 拒绝取消订阅 {topic}：{reason} —— 它可能仍在投递',
    clearRetainFailed: '清除 retained 消息失败',
    clearMessagesConfirm: '再点一次以清空当前列表',
    unsubscribeFailed: '取消订阅 {topic} 失败',
    subscribeFailed: '订阅 {topic} 失败',
    connectFailed: '连接失败',
    updateCheckFailed: '检查更新失败',
    subShareGroupRequired: '请先填写共享组名',
    publishRejectedToast: 'broker 拒绝了这条发布：{reason}',
    publishRejectedManyToast: 'broker 拒绝了 {n} 条发布：{reason}',
    opsRejectedSubs: '被拒订阅',
    opsRefusedUnsubs: '被拒取消订阅',
    opsPublishRejected: '被拒发布',
    opsAcksUnattributed: '无法对应的应答码',
    opsFeedFlushMs: '进料刷新 均值/最大 (ms)',
    opsFeedLagMs: '刷新迟到 均值/最大 (ms)',
    opsHistoryWriteMs: '历史写入 均值/最大 (ms)',
    opsCalls: '次调用',
    opsLagHint: '相对 100ms 节拍',
    cmpTopic: '主题',
    cmpDirection: '方向',
    cmpUserProps: '用户属性',
    cmpPayload: '负载',
    compareToggle: '对比',
    comparePickTwo: '选中两条报文进行对比',
    compareTooLarge: '负载过大，无法逐行对齐 —— 只显示原文',
    benchNoSubscribers: '无订阅者',
    corrHexHint: '以原始字节的十六进制显示关联数据',
    matchedByBrokerHint: 'broker 用订阅标识符报回的命中订阅',
    matchedByLocalHint: '本地匹配的命中订阅（broker 未回传标识符）',
    corrHexBadge: '十六进制',
    rpcNoCorrelation: '应答未带关联数据',
    ackCodeGrantedQos: '已授予 QoS {qos}',
    ackCodeUnspecified: '未说明的错误',
    ackCodeImplSpecific: '服务器实现特定错误',
    ackCodeNotAuthorized: '未授权（ACL）',
    ackCodeTopicFilterInvalid: '主题过滤器非法',
    ackCodeTopicNameInvalid: '主题名非法',
    ackCodePkidInUse: '报文标识符已被占用',
    ackCodePkidNotFound: '报文标识符不存在',
    ackCodeQuotaExceeded: '配额超限',
    ackCodeSharedSubsUnsupported: '不支持共享订阅',
    ackCodeSubIdUnsupported: '不支持订阅标识符',
    ackCodeWildcardSubsUnsupported: '不支持通配符订阅',
    ackCodeNoSubscribers: '没有匹配的订阅者',
    ackCodePayloadFormatInvalid: '负载格式非法',
    ackCodeNoSubscriptionExisted: '原本就没有该订阅',
    ackCodeUnrecognized: '未识别的应答码 {code}',
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
    schedulesTitle: '定时发布',
    scheduleNote: '由后端调度：切换工作区、关闭面板或界面刷新都不会中断，断连时自动停止。',
    scheduleUnsupported: 'CBOR 载荷无法定时发布，请手动发送。',
    scheduleEmpty: '暂无定时任务',
    scheduleStopAll: '全部停止',
    scheduleRunNow: '运行中',
    scheduleRunDone: '已完成',
    scheduleRunFailed: '已失败',
    scheduleRunStopped: '已停止',
    rpcTitle: '请求 / 响应',
    rpcAwaitReply: '等待应答',
    rpcTimeoutLabel: '超时 (ms)',
    rpcHint: '请求会带上应答主题与关联数据；应答优先按关联数据配对，未带时按发送先后配对',
    rpcPending: '待应答',
    rpcResolved: '已应答',
    rpcNoReply: '无应答',
    rpcRoundTrip: '往返',
    rpcResponseTopicPh: '留空自动生成',
    rpcPairedByPosition: '按先后配对（应答未带关联数据）',
    rpcCorrelationLabel: '关联数据',
    rpcReplyBody: '应答内容',
    rpcClear: '清除已结束',
    rpcEmpty: '还没有请求；打开“等待应答”后发布即成为请求',
    opsRpcPending: '待应答请求',
    opsRpcTimeouts: '无应答请求',
    uiWorkspaceMode: '工作区模式',
    modeSubTransfer: '分块传输',
    modeSubConsole: '发布 / 订阅',
    modeSubBridge: 'Broker ↔ Broker / HTTP',
    btnTemplate: '模板',
    btnPrettify: '格式化',
    publishingNow: '发送中…',
    payloadTruncatedTip: '控制台仅显示前段内容，展开行可看到完整报文',
    clickToExpand: '⋯ 点击展开',
    copyBtn: '复制',
    copiedBtn: '已复制 ✓',
    chunkHintIot: '(IoT / 受限链路)',
    chunkHintRecommended: '(推荐)',
    chunkHintFast: '(高速)',
    chunkHintLan: '(局域网)',
    chunkHintMax: '(最大)',
    brokerUserPh: '用户名 / Token',
    subscribeFailedAtConnect: '{count} 个订阅注册失败：{detail}',
    batchSummaryAll: '{count} 个文件已送达并对端校验通过',
    batchSummaryPartial: '{delivered} 个已送达，{other} 个未确认或失败',
    trafficFilterPh: '按主题名过滤',
    deleteConfirmAgain: '再点一次确认删除',
    testRunning: '试运行中…',
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
    publishInterval: 'Interval (ms)',
    publishCount: 'Count',
    publishCountHint: '0 = loop until stopped',
    publishDevices: 'Devices',
    publishDevicesHint: 'how many simulated devices each tick emits to (${device} cycles 1..N)',
    benchExpectTitle: 'Acceptance bar',
    benchExpectMinRate: 'min rate /s',
    benchExpectP99: 'max p99 ms',
    benchExpectLost: 'max unacked',
    benchVerdictPass: 'PASS',
    benchVerdictFail: 'FAIL',
    benchVerdictPending: 'running',
    benchFailMinRate: 'rate {actual}/s is below the required {limit}/s',
    benchFailP99: 'p99 {actual} ms exceeds the required {limit} ms',
    benchFailLost: '{actual} unacked, allowed {limit}',
    benchFailNoSamples: 'no loopback samples, p99 cannot be judged',
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
    sysRetained: 'Retained',
    sysSubscriptions: 'Subscriptions',
    sysBytesIn: 'Bytes in',
    sysBytesOut: 'Bytes out',
    sysNoDialect: 'No verified $SYS layout for this broker ({vendor}) — showing the raw tree',
    sysUnknownVendor: 'unknown vendor',
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
    opsScheduledRuns: 'scheduled runs',
    opsBenchRuns: 'bench runs',
    opsConfirmTimeouts: 'unconfirmed sends',
    opsHistoryLost: 'history rows lost',
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
    opsFeedLost: 'Feed lost (incl. history)',
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
    historyAllTime: "All time",
    historyPerBucket: "/ bucket",
    historyExportResults: "Export current filtered results",
    integrationRecipes: "Integration recipes",
    recipeTelemetry: "Telemetry to business API",
    recipeTelemetryHint: "Send device telemetry as JSON with its topic and timestamp.",
    recipeAlert: "Temperature alerts",
    recipeAlertHint: "Filter readings below 40°C and send alerts to a webhook.",
    recipeBroker: "Edge site aggregation",
    recipeBrokerHint: "Add a site prefix and forward to an upstream broker.",
    integrationTarget: "Forwarding target",
    webhookUrl: "Webhook URL",
    webhookBody: "Request body",
    webhookEnvelope: "JSON envelope (topic, time, payload)",
    webhookRaw: "Raw payload (custom APIs)",
    webhookHeaders: "Headers (one Name: value per line)",
    webhookHint: "Connect the source broker only. Up to 4 HTTP requests run concurrently with a 10-second timeout. Busy or over-2-MB requests count as dropped; no automatic retries. Headers are stored locally.",
    webhookInvalid: "Enter a valid HTTP(S) URL and headers; use headers for authentication.",
    webhookExportHint: "HTTP rule exports omit URLs and headers and disable the rules. Configure them again after importing.",
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
    uiCrashedTitle: '{area} failed to render',
    uiCrashedHint: 'This workspace stopped rendering; your connection and other workspaces are unaffected. Retry, or export a diagnostics report from Ops.',
    uiCrashedRetry: 'Retry this view',
    codecTitle: 'Payload codec script (display only)',
    codecHint: 'function transform(topic, payload, qos, retain) returns the text to display. Raw payloads, history, export and replay are untouched; a row whose script throws keeps the original and is flagged.',
    codecClear: 'Clear script',
    codecOn: 'Codec on',
    codecOff: 'Codec',
    codecFailed: 'Codec failed',
    codecPending: 'Decoding…',
    senmlView: 'SenML readings table (RFC 8428)',
    silenceTitle: 'Silence alerts',
    silenceAdd: 'New alert',
    silenceHint: 'POSTs an alert to a webhook when a topic filter carries no traffic for the configured number of seconds. Repeat alerts for one continuous outage are suppressed by the cooldown, and a device reporting again clears the timer.',
    silenceNeedsConnection: 'Not connected: while disconnected, silence is never attributed to the device.',
    silenceFilter: 'Topic filter',
    silenceTimeout: 'Silence threshold (s)',
    silenceCooldown: 'Cooldown (s)',
    silenceNoRules: 'No silence alerts configured yet.',
    silenceAfter: 'silent {n}s',
    silenceEvery: 'max once per {n}s',
    silenceLog: 'Alert log',
    silenceEmpty: 'No alerts yet.',
    silenceNeedFields: 'Name and topic filter are both required.',
    silenceMinTimeout: 'Silence threshold must be at least {n} seconds (last-seen has 1s resolution).',
    silenceEnabled: 'Enabled',
    actualTopicNote: 'Counted per actual arrived topic, not wildcard filter',
    trafficCap: 'Topic tracking hit the 1000 cap — new topics not counted',
    benchLab: 'Bench Lab',
    benchTopicPh: 'Bench topics, comma or space separated (loops back into your subscriptions)',
    benchRate: 'rate/s',
    benchSize: 'bytes',
    benchDuration: 'secs',
    benchStart: 'Start bench',
    benchHint: 'Publishes high-rate load to the broker to verify stat accuracy & UI smoothness',
    benchSent: 'sent',
    benchFailed: 'Start failed: check connection',
    benchStop: 'Stop',
    benchAcked: 'acked',
    benchObserved: 'timed',
    benchLatency: 'loopback latency',
    benchClear: 'Clear finished',
    benchDurationHint: '0 = until stopped',
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
    subV5Options: 'MQTT5 subscription options',
    subNoLocalHint: 'Do not receive my own publishes',
    subRetainAsPublishedHint: 'Keep the RETAIN flag when forwarding',
    subRetainHandling: 'Retain Handling',
    subRetainHandling0: '0 · send retained on every subscribe',
    subRetainHandling1: '1 · send only on a new subscription',
    subRetainHandling2: '2 · never send retained',
    subShareToggle: 'Shared subscription',
    subShareGroup: 'Shared group',
    subShareHint: 'Members of one shared group receive messages in rotation, which is how the consumer side scales out. The group name may not contain / + #, it cannot be combined with No Local, and the mechanism only exists in MQTT5.',
    subShareChip: 'share group {name}',
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
    confirmTimeout: 'Sent · peer never confirmed',
    resendHint: 'Resend as a new transfer',
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
    sessionExpiry: 'Session expiry (s)',
    sessionExpiryHint: 'MQTT5 Session-Expiry-Interval: how long the broker keeps the session and offline QoS1/2 messages after a drop; empty sends no property',
    willDelay: 'Will delay (s)',
    willContentType: 'Will content type',
    payloadFormatHint: 'MQTT5 Payload Format Indicator: 0 = bytes, 1 = UTF-8; unset keeps the property off the wire',
    payloadFormatUnset: 'PFI · unset',
    topicAliasLabel: 'Topic alias',
    topicAliasHint: 'MQTT5 topic aliases are per-connection and capped by the topic-alias-maximum the broker announces in CONNACK; an oversized one is rejected rather than dropping the link. The first publish that assigns an alias must also carry the full topic',
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
    subRejectedChip: 'refused: {reason}',
    subQuarantinedHint: 'not retried until you subscribe again (a refused SUBACK drops the session)',
    capQosCeiling: 'broker accepts up to QoS {n}',
    capRetainOff: 'this broker has retain unavailable (retain-available = 0)',
    capSharedOff: 'this broker does not support shared subscriptions',
    capWildcardOff: 'this broker does not support wildcard subscriptions',
    capAliasMax: 'topic aliases up to {n}',
    capPacketSize: 'packet limit {n} B',
    capReceiveMax: 'receive maximum {n}',
    capSessionExpiry: 'session expiry {n} s',
    capServerKeepAlive: 'server keep-alive {n} s',
    capAssignedClientId: 'assigned by server',
    capResponseInfo: 'response information',
    capServerRef: 'server reference',
    opsBrokerCapabilities: 'Broker-announced capabilities',
    capAnnouncedAfterConnect: 'announced by CONNACK once connected',
    capAvailable: 'supported',
    capUnavailable: 'not supported',
    capRowWildcard: 'wildcards',
    capRowAlias: 'topic aliases',
    capRowReceive: 'receive maximum',
    capRowPacket: 'packet size',
    subRejectedToast: 'Broker refused {topic}: {reason}',
    subDowngradedToast: 'Broker capped {topic} at QoS {qos}',
    unsubRejectedToast: 'Broker refused to unsubscribe {topic}: {reason} — it may still be delivering',
    clearRetainFailed: 'Failed to clear retained messages',
    clearMessagesConfirm: 'click again to clear this list',
    unsubscribeFailed: 'Failed to unsubscribe {topic}',
    subscribeFailed: 'Failed to subscribe {topic}',
    connectFailed: 'Connection failed',
    updateCheckFailed: 'Update check failed',
    subShareGroupRequired: 'enter a share group name first',
    publishRejectedToast: 'Broker refused a publish: {reason}',
    publishRejectedManyToast: 'Broker refused {n} publishes: {reason}',
    opsRejectedSubs: 'Refused subscriptions',
    opsRefusedUnsubs: 'Refused unsubscribes',
    opsPublishRejected: 'Refused publishes',
    opsAcksUnattributed: 'Unmatched ack codes',
    opsFeedFlushMs: 'Feed flush avg/max (ms)',
    opsFeedLagMs: 'Flush lateness avg/max (ms)',
    opsHistoryWriteMs: 'History write avg/max (ms)',
    opsCalls: 'calls',
    opsLagHint: 'against the 100 ms cadence',
    cmpTopic: 'Topic',
    cmpDirection: 'Direction',
    cmpUserProps: 'User properties',
    cmpPayload: 'Payload',
    compareToggle: 'Compare',
    comparePickTwo: 'pick two messages to compare',
    compareTooLarge: 'payloads too large to align line by line — showing both verbatim',
    benchNoSubscribers: 'no subscribers',
    corrHexHint: 'Correlation data shown as hex of the raw bytes',
    matchedByBrokerHint: 'subscription the broker said it matched',
    matchedByLocalHint: 'matched here — the broker sent no Subscription Identifier',
    corrHexBadge: 'hex',
    rpcNoCorrelation: 'reply carried no correlation data',
    ackCodeGrantedQos: 'granted QoS {qos}',
    ackCodeUnspecified: 'unspecified error',
    ackCodeImplSpecific: 'implementation specific error',
    ackCodeNotAuthorized: 'not authorized (ACL)',
    ackCodeTopicFilterInvalid: 'topic filter invalid',
    ackCodeTopicNameInvalid: 'topic name invalid',
    ackCodePkidInUse: 'packet identifier in use',
    ackCodePkidNotFound: 'packet identifier not found',
    ackCodeQuotaExceeded: 'quota exceeded',
    ackCodeSharedSubsUnsupported: 'shared subscriptions not supported',
    ackCodeSubIdUnsupported: 'subscription identifiers not supported',
    ackCodeWildcardSubsUnsupported: 'wildcard subscriptions not supported',
    ackCodeNoSubscribers: 'no matching subscribers',
    ackCodePayloadFormatInvalid: 'payload format invalid',
    ackCodeNoSubscriptionExisted: 'no subscription existed',
    ackCodeUnrecognized: 'unrecognized reason code {code}',
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
    schedulesTitle: 'Scheduled Runs',
    scheduleNote: 'Scheduled in the backend: switching workspaces, closing this panel or reloading the window keeps them running; a disconnect stops them.',
    scheduleUnsupported: 'CBOR payloads cannot be scheduled — publish them manually.',
    scheduleEmpty: 'No scheduled runs',
    scheduleStopAll: 'Stop All',
    scheduleRunNow: 'Running',
    scheduleRunDone: 'Done',
    scheduleRunFailed: 'Failed',
    scheduleRunStopped: 'Stopped',
    rpcTitle: 'Request / Response',
    rpcAwaitReply: 'Await reply',
    rpcTimeoutLabel: 'Timeout (ms)',
    rpcHint: 'A request carries a response topic and correlation data; replies pair by correlation data, or by send order when they carry none',
    rpcPending: 'Pending',
    rpcResolved: 'Answered',
    rpcNoReply: 'No reply',
    rpcRoundTrip: 'Round trip',
    rpcResponseTopicPh: 'blank = generated',
    rpcPairedByPosition: 'paired by order (reply carried no correlation data)',
    rpcCorrelationLabel: 'Correlation data',
    rpcReplyBody: 'Reply body',
    rpcClear: 'Clear finished',
    rpcEmpty: 'No requests yet — turn on “Await reply” and publish to make one',
    opsRpcPending: 'pending requests',
    opsRpcTimeouts: 'unanswered requests',
    uiWorkspaceMode: 'Workspace Mode',
    modeSubTransfer: 'Chunked Transfer',
    modeSubConsole: 'Pub/Sub Console',
    modeSubBridge: 'Broker ↔ Broker / HTTP',
    btnTemplate: 'Template',
    btnPrettify: 'Prettify',
    publishingNow: 'Publishing…',
    payloadTruncatedTip: 'Only the head of the payload is shown in the feed; expand the row for the whole message',
    clickToExpand: '⋯ click to expand',
    copyBtn: 'Copy',
    copiedBtn: 'Copied ✓',
    chunkHintIot: '(IoT / Restricted)',
    chunkHintRecommended: '(Recommended)',
    chunkHintFast: '(High Speed)',
    chunkHintLan: '(LAN / Fast)',
    chunkHintMax: '(Maximum)',
    brokerUserPh: 'User / Token',
    subscribeFailedAtConnect: '{count} subscription(s) failed to register: {detail}',
    batchSummaryAll: '{count} file(s) delivered and confirmed by the peer',
    batchSummaryPartial: '{delivered} delivered, {other} unconfirmed or failed',
    trafficFilterPh: 'filter topics',
    deleteConfirmAgain: 'click again to confirm',
    testRunning: 'Testing…',
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
    publishInterval: '間隔 (毫秒)',
    publishCount: '次數',
    publishCountHint: '0 = 無限循環直到手動停止',
    publishDevices: '裝置數',
    publishDevicesHint: '每一拍向多少個模擬裝置發送（${device} 從 1 到該值輪替）',
    benchExpectTitle: '驗收閾值',
    benchExpectMinRate: '最低速率 /s',
    benchExpectP99: '最高 p99 ms',
    benchExpectLost: '最多未確認',
    benchVerdictPass: '通過',
    benchVerdictFail: '未通過',
    benchVerdictPending: '進行中',
    benchFailMinRate: '速率 {actual}/s 低於要求的 {limit}/s',
    benchFailP99: 'p99 {actual} ms 高於要求的 {limit} ms',
    benchFailLost: '{actual} 則未確認，要求不超過 {limit}',
    benchFailNoSamples: '沒有回環樣本，無法判定 p99',
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
    sysRetained: '保留訊息',
    sysSubscriptions: '訂閱數',
    sysBytesIn: '接收位元組',
    sysBytesOut: '發送位元組',
    sysNoDialect: '未識別該 broker 的 $SYS 佈局（{vendor}），只顯示原始樹',
    sysUnknownVendor: '未知廠商',
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
    opsScheduledRuns: '定時發布執行中',
    opsBenchRuns: '壓測執行中',
    opsConfirmTimeouts: '對端未確認的發送',
    opsHistoryLost: '未能寫入歷史',
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
    opsFeedLost: 'Feed 丟失（含歷史）',
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
    historyAllTime: "全部時間",
    historyPerBucket: "/ 時段",
    historyExportResults: "匯出目前篩選結果",
    integrationRecipes: "整合情境範本",
    recipeTelemetry: "遙測接入業務 API",
    recipeTelemetryHint: "將裝置遙測轉為包含主題與時間的 JSON 請求。",
    recipeAlert: "溫度閾值告警",
    recipeAlertHint: "過濾低於 40°C 的訊息，將告警轉成 Webhook 請求。",
    recipeBroker: "邊緣站點彙整",
    recipeBrokerHint: "為上行主題加入站點前綴，彙整到另一台 Broker。",
    integrationTarget: "轉送目標",
    webhookUrl: "Webhook 位址",
    webhookBody: "請求內容格式",
    webhookEnvelope: "JSON 封裝（主題、時間、內容）",
    webhookRaw: "原始內容（自訂 API）",
    webhookHeaders: "請求標頭（每行 名稱: 值）",
    webhookHint: "僅需連線來源 Broker。最多同時執行 4 個 HTTP 請求，10 秒逾時；忙碌或超過 2 MB 的請求計入丟棄，不自動重試。標頭僅儲存在本機。",
    webhookInvalid: "請輸入有效的 HTTP(S) 位址與標頭；驗證請使用標頭。",
    webhookExportHint: "匯出 HTTP 規則時會移除位址與標頭並停用規則；匯入後請重新設定。",
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
    uiCrashedTitle: '{area} 渲染失敗',
    uiCrashedHint: '該工作區已停止渲染，連線與其他工作區不受影響。可重試，或到「維運與診斷」匯出診斷報告。',
    uiCrashedRetry: '重試此檢視',
    codecTitle: '載體編解碼腳本（僅影響顯示）',
    codecHint: 'function transform(topic, payload, qos, retain) 回傳要顯示的文字。原始報文與歷史、匯出、重發完全不受影響；拋錯的行會保留原文並標示。',
    codecClear: '清除腳本',
    codecOn: '編解碼已啟用',
    codecOff: '編解碼',
    codecFailed: '編解碼失敗',
    codecPending: '解碼中…',
    senmlView: 'SenML 讀數表（RFC 8428）',
    silenceTitle: '靜默告警',
    silenceAdd: '新建告警',
    silenceHint: '當某個主題過濾器在設定秒數內沒有任何訊息時，向 Webhook POST 告警；同一次持續離線依冷卻時間抑制重複告警，裝置恢復上報後計時器自動歸零。',
    silenceNeedsConnection: '目前未連線：中斷期間不會判定為裝置靜默。',
    silenceFilter: '主題過濾器',
    silenceTimeout: '靜默閾值（秒）',
    silenceCooldown: '冷卻時間（秒）',
    silenceNoRules: '還沒有靜默告警規則。',
    silenceAfter: '{n} 秒無訊息',
    silenceEvery: '每 {n} 秒最多一次',
    silenceLog: '告警記錄',
    silenceEmpty: '暫無告警。',
    silenceNeedFields: '名稱與主題過濾器皆不可為空。',
    silenceMinTimeout: '靜默閾值至少 {n} 秒（最後上報僅有 1 秒精度）。',
    silenceEnabled: '啟用',
    actualTopicNote: '按實際到達主題統計，非萬用字元過濾器',
    trafficCap: '主題數已達 1000 上限，新主題不再統計',
    benchLab: '壓測台',
    benchTopicPh: '壓測主題，逗號或空格分隔（回環計入自己的訂閱統計）',
    benchRate: '速率/s',
    benchSize: '位元組',
    benchDuration: '秒',
    benchStart: '開始壓測',
    benchHint: '向本地 broker 發布高壓流量，驗證統計精度與介面流暢度',
    benchSent: '已發送',
    benchFailed: '啟動失敗：檢查連線狀態',
    benchStop: '停止',
    benchAcked: '已確認',
    benchObserved: '已採樣',
    benchLatency: '回環延遲',
    benchClear: '清除已結束',
    benchDurationHint: '0 = 直到手動停止',
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
    subV5Options: 'MQTT5 訂閱選項',
    subNoLocalHint: '不接收自己發布的回環',
    subRetainAsPublishedHint: '轉發時保留 RETAIN 旗標',
    subRetainHandling: 'Retain Handling',
    subRetainHandling0: '0 · 每次訂閱都下發保留訊息',
    subRetainHandling1: '1 · 僅新訂閱時下發',
    subRetainHandling2: '2 · 從不下發保留訊息',
    subShareToggle: '共享訂閱',
    subShareGroup: '共享群組',
    subShareHint: '同一共享群組內的多個實例由 broker 輪流派發，用於消費端水平擴展。群組名不能含 / + #，不能與 No Local 同時使用，且只有 MQTT5 有此機制。',
    subShareChip: '共享群組 {name}',
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
    confirmTimeout: '已發送·對端未確認',
    resendHint: '重新發送（作為一筆新傳輸）',
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
    sessionExpiry: '工作階段過期 (秒)',
    sessionExpiryHint: 'MQTT5 Session-Expiry-Interval：斷線後 broker 保留工作階段與離線 QoS1/2 訊息的時間；留空表示不傳送該屬性',
    willDelay: '遺囑延遲 (秒)',
    willContentType: '遺囑 Content-Type',
    payloadFormatHint: 'MQTT5 Payload Format Indicator：0=位元組流，1=UTF-8；不設定則不傳送該屬性',
    payloadFormatUnset: 'PFI · 不設定',
    topicAliasLabel: '主題別名 (Topic Alias)',
    topicAliasHint: 'MQTT5 主題別名以連線為單位，且受 broker 在 CONNACK 通告的 topic-alias-maximum 限制；超出會被拒絕而非斷線。首次帶別名的發布必須同時帶完整主題',
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
    subRejectedChip: '被拒：{reason}',
    subQuarantinedHint: '在重新訂閱前不會重試（被拒的 SUBACK 會中斷工作階段）',
    capQosCeiling: 'broker 最高支援 QoS {n}',
    capRetainOff: '該 broker 不支援 retain（retain-available = 0）',
    capSharedOff: '該 broker 不支援共享訂閱',
    capWildcardOff: '該 broker 不支援萬用字元訂閱',
    capAliasMax: '主題別名上限 {n}',
    capPacketSize: '報表上限 {n} B',
    capReceiveMax: '接收上限 {n}',
    capSessionExpiry: '工作階段逾期 {n} 秒',
    capServerKeepAlive: '伺服器 keep-alive {n} 秒',
    capAssignedClientId: '由伺服器指派',
    capResponseInfo: '回應資訊',
    capServerRef: '伺服器引用',
    opsBrokerCapabilities: 'broker 通告的能力',
    capAnnouncedAfterConnect: '連線後由 CONNACK 通告',
    capAvailable: '支援',
    capUnavailable: '不支援',
    capRowWildcard: '萬用字元訂閱',
    capRowAlias: '主題別名',
    capRowReceive: '接收上限',
    capRowPacket: '報表大小',
    subRejectedToast: 'broker 拒絕訂閱 {topic}：{reason}',
    subDowngradedToast: 'broker 將 {topic} 降為 QoS {qos}',
    unsubRejectedToast: 'broker 拒絕取消訂閱 {topic}：{reason} —— 它可能仍在投递',
    clearRetainFailed: '清除 retained 訊息失敗',
    clearMessagesConfirm: '再點一次以清空目前清單',
    unsubscribeFailed: '取消訂閱 {topic} 失敗',
    subscribeFailed: '訂閱 {topic} 失敗',
    connectFailed: '連線失敗',
    updateCheckFailed: '檢查更新失敗',
    subShareGroupRequired: '請先填寫共享組名',
    publishRejectedToast: 'broker 拒絕了這則發佈：{reason}',
    publishRejectedManyToast: 'broker 拒絕了 {n} 則發佈：{reason}',
    opsRejectedSubs: '被拒訂閱',
    opsRefusedUnsubs: '被拒取消訂閱',
    opsPublishRejected: '被拒發佈',
    opsAcksUnattributed: '無法對應的應答碼',
    opsFeedFlushMs: '進料刷新 平均/最大 (ms)',
    opsFeedLagMs: '刷新遲到 平均/最大 (ms)',
    opsHistoryWriteMs: '歷史寫入 平均/最大 (ms)',
    opsCalls: '次呼叫',
    opsLagHint: '相對於 100ms 節拍',
    cmpTopic: '主題',
    cmpDirection: '方向',
    cmpUserProps: '使用者屬性',
    cmpPayload: '載入',
    compareToggle: '對比',
    comparePickTwo: '選取兩則報文進行對比',
    compareTooLarge: '載入過大，無法逐行對齊 —— 只顯示原文',
    benchNoSubscribers: '無訂閱者',
    corrHexHint: '以原始位元組的十六進位顯示關聯資料',
    matchedByBrokerHint: 'broker 以訂閱識別號回報的命中訂閱',
    matchedByLocalHint: '本機比對的命中訂閱（broker 未回傳識別號）',
    corrHexBadge: '十六進位',
    rpcNoCorrelation: '應答未帶關聯資料',
    ackCodeGrantedQos: '已授予 QoS {qos}',
    ackCodeUnspecified: '未說明的錯誤',
    ackCodeImplSpecific: '伺服器實作特定錯誤',
    ackCodeNotAuthorized: '未授權（ACL）',
    ackCodeTopicFilterInvalid: '主題過濾器非法',
    ackCodeTopicNameInvalid: '主題名非法',
    ackCodePkidInUse: '報表識別碼已被佔用',
    ackCodePkidNotFound: '報表識別碼不存在',
    ackCodeQuotaExceeded: '配額超限',
    ackCodeSharedSubsUnsupported: '不支援共享訂閱',
    ackCodeSubIdUnsupported: '不支援訂閱識別碼',
    ackCodeWildcardSubsUnsupported: '不支援萬用字元訂閱',
    ackCodeNoSubscribers: '沒有相符的訂閱者',
    ackCodePayloadFormatInvalid: '載入格式非法',
    ackCodeNoSubscriptionExisted: '原本就沒有該訂閱',
    ackCodeUnrecognized: '未識別的應答碼 {code}',
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
    schedulesTitle: '定時發布',
    scheduleNote: '由後端排程：切換工作區、關閉面板或重新整理介面都不會中斷，斷線時自動停止。',
    scheduleUnsupported: 'CBOR 載荷無法定時發布，請手動發送。',
    scheduleEmpty: '暫無定時任務',
    scheduleStopAll: '全部停止',
    scheduleRunNow: '執行中',
    scheduleRunDone: '已完成',
    scheduleRunFailed: '已失敗',
    scheduleRunStopped: '已停止',
    rpcTitle: '請求 / 回應',
    rpcAwaitReply: '等待應答',
    rpcTimeoutLabel: '逾時 (ms)',
    rpcHint: '請求會帶上應答主題與關聯資料；應答優先依關聯資料配對，未帶時依發送先後配對',
    rpcPending: '待應答',
    rpcResolved: '已應答',
    rpcNoReply: '無應答',
    rpcRoundTrip: '往返',
    rpcResponseTopicPh: '留空自動產生',
    rpcPairedByPosition: '依先後配對（應答未帶關聯資料）',
    rpcCorrelationLabel: '關聯資料',
    rpcReplyBody: '應答內容',
    rpcClear: '清除已結束',
    rpcEmpty: '還沒有請求；開啟「等待應答」後發布即成為請求',
    opsRpcPending: '待應答請求',
    opsRpcTimeouts: '無應答請求',
    uiWorkspaceMode: '工作區模式',
    modeSubTransfer: '分塊傳輸',
    modeSubConsole: '發布 / 訂閱',
    modeSubBridge: 'Broker ↔ Broker / HTTP',
    btnTemplate: '範本',
    btnPrettify: '格式化',
    publishingNow: '發送中…',
    payloadTruncatedTip: '控制台僅顯示前段內容，展開行可看到完整報文',
    clickToExpand: '⋯ 點擊展開',
    copyBtn: '複製',
    copiedBtn: '已複製 ✓',
    chunkHintIot: '(IoT / 受限鏈路)',
    chunkHintRecommended: '(推薦)',
    chunkHintFast: '(高速)',
    chunkHintLan: '(區域網)',
    chunkHintMax: '(最大)',
    brokerUserPh: '使用者名稱 / Token',
    subscribeFailedAtConnect: '{count} 個訂閱註冊失敗：{detail}',
    batchSummaryAll: '{count} 個檔案已送達並對端驗證通過',
    batchSummaryPartial: '{delivered} 個已送達，{other} 個未確認或失敗',
    trafficFilterPh: '依主題名過濾',
    deleteConfirmAgain: '再點一次確認刪除',
    testRunning: '試運行中…',
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
    publishInterval: '間隔 (ミリ秒)',
    publishCount: '回数',
    publishCountHint: '0 = 手動停止までループ',
    publishDevices: 'デバイス数',
    publishDevicesHint: '各ティックで何台の模擬デバイスへ送るか（${device} は 1..N を巡回）',
    benchExpectTitle: '受け入れ基準',
    benchExpectMinRate: '最低速率 /s',
    benchExpectP99: '最高 p99 ms',
    benchExpectLost: '最大未確認',
    benchVerdictPass: '合格',
    benchVerdictFail: '不合格',
    benchVerdictPending: '実行中',
    benchFailMinRate: '速率 {actual}/s が要求の {limit}/s を下回っています',
    benchFailP99: 'p99 {actual} ms が要求の {limit} ms を超えています',
    benchFailLost: '{actual} 件未確認、許容 {limit}',
    benchFailNoSamples: 'ループバック標本がなく p99 を判定できません',
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
    sysRetained: 'retained',
    sysSubscriptions: 'サブスクリプション',
    sysBytesIn: '受信バイト',
    sysBytesOut: '送信バイト',
    sysNoDialect: 'このブローカー ({vendor}) の $SYS 配置は未検証です — 生のツリーを表示',
    sysUnknownVendor: 'ベンダー不明',
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
    opsScheduledRuns: '定期発行の実行中',
    opsBenchRuns: 'ベンチの実行中',
    opsConfirmTimeouts: '未確認の送信',
    opsHistoryLost: '履歴書き込み失敗',
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
    opsFeedLost: 'Feed 消失（履歴含む）',
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
    historyAllTime: "全期間",
    historyPerBucket: "/ 区間",
    historyExportResults: "現在の検索結果をエクスポート",
    integrationRecipes: "連携テンプレート",
    recipeTelemetry: "テレメトリーを API へ",
    recipeTelemetryHint: "トピックと時刻を含む JSON として測定値を送信します。",
    recipeAlert: "温度アラート",
    recipeAlertHint: "40°C 未満を除外し、Webhook にアラートを送信します。",
    recipeBroker: "拠点データの集約",
    recipeBrokerHint: "拠点の接頭辞を付けて上位 Broker に転送します。",
    integrationTarget: "転送先",
    webhookUrl: "Webhook URL",
    webhookBody: "リクエスト本文",
    webhookEnvelope: "JSON（トピック・時刻・ペイロード）",
    webhookRaw: "元のペイロード（独自 API）",
    webhookHeaders: "ヘッダー（1 行に 名前: 値）",
    webhookHint: "接続は送信元 Broker のみ必要です。HTTP は同時に最大 4 件、タイムアウトは 10 秒です。混雑時や 2 MB 超は破棄として集計し、自動再試行しません。ヘッダーはローカル保存です。",
    webhookInvalid: "有効な HTTP(S) URL とヘッダーを入力してください。認証にはヘッダーを使います。",
    webhookExportHint: "HTTP ルールの出力では URL とヘッダーを除外して無効にします。読み込み後に再設定してください。",
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
    uiCrashedTitle: '{area} の描画に失敗しました',
    uiCrashedHint: 'このワークスペースの描画が停止しましたが、接続や他のワークスペースは影響を受けません。再試行するか、運用診断から診断レポートをエクスポートしてください。',
    uiCrashedRetry: 'このビューを再試行',
    codecTitle: 'ペイロードコーデック（表示のみ）',
    codecHint: 'function transform(topic, payload, qos, retain) が表示するテキストを返します。生のペイロード・履歴・エクスポート・再送信は影響を受けません。',
    codecClear: 'スクリプトを消去',
    codecOn: 'コーデック ON',
    codecOff: 'コーデック',
    codecFailed: 'コーデック失敗',
    codecPending: '解読中…',
    senmlView: 'SenML 計測値テーブル（RFC 8428）',
    silenceTitle: '無通信アラート',
    silenceAdd: 'アラート作成',
    silenceHint: 'トピックフィルタが設定秒間通信が無い場合、Webhook に POST でアラートします。同一障害中の重複はクールダウンで抑制され、端末が応答を再開するとタイマはリセットされます。',
    silenceNeedsConnection: '未接続：切断中は端末の無通信とは判定されません。',
    silenceFilter: 'トピックフィルタ',
    silenceTimeout: '無通信閾値（秒）',
    silenceCooldown: 'クールダウン（秒）',
    silenceNoRules: '無通信アラートはまだありません。',
    silenceAfter: '{n} 秒通信なし',
    silenceEvery: '{n} 秒に最大 1 回',
    silenceLog: 'アラート履歴',
    silenceEmpty: 'アラートはまだありません。',
    silenceNeedFields: '名前とトピックフィルタは必須です。',
    silenceMinTimeout: '無通信閾値は最低 {n} 秒です（最終受信の精度は 1 秒）。',
    silenceEnabled: '有効',
    actualTopicNote: '実際に届いたトピック単位で集計（ワイルドカードではない）',
    trafficCap: 'トピック追跡が 1000 上限に到達 — 新規は非集計',
    benchLab: 'ベンチ台',
    benchTopicPh: 'ベンチトピック（カンマ/スペース区切り、自分の購読にループバック）',
    benchRate: '速度/s',
    benchSize: 'バイト',
    benchDuration: '秒',
    benchStart: 'ベンチ開始',
    benchHint: 'ブローカーへ高負荷送信し統計精度と UI 応答性を検証',
    benchSent: '送信済',
    benchFailed: '開始失敗：接続を確認してください',
    benchStop: '停止',
    benchAcked: 'ack 済み',
    benchObserved: '計測数',
    benchLatency: 'ループバック遅延',
    benchClear: '終了分を消去',
    benchDurationHint: '0 = 手動停止まで',
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
    subV5Options: 'MQTT5 購読オプション',
    subNoLocalHint: '自分が発行したメッセージは受け取らない',
    subRetainAsPublishedHint: '転送時に RETAIN フラグを保持する',
    subRetainHandling: 'Retain Handling',
    subRetainHandling0: '0 · 購読ごとに保持メッセージを送る',
    subRetainHandling1: '1 · 新規購読のときだけ送る',
    subRetainHandling2: '2 · 保持メッセージを送らない',
    subShareToggle: '共有サブスクライブ',
    subShareGroup: '共有グループ',
    subShareHint: '同一グループの複数インスタンスにはブローカーが順番に配信します（消費者側の水平スケール）。グループ名に / + # は使えず、No Local との併用は不可、この仕組みは MQTT5 のみです。',
    subShareChip: '共有グループ {name}',
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
    confirmTimeout: '送信完了·相手確認なし',
    resendHint: '新しい転送として再送',
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
    sessionExpiry: 'セッション有効期間 (秒)',
    sessionExpiryHint: 'MQTT5 Session-Expiry-Interval：切断後にブローカーがセッションとオフライン QoS1/2 メッセージを保持する時間。空ならプロパティを送りません',
    willDelay: 'Will 遅延 (秒)',
    willContentType: 'Will Content-Type',
    payloadFormatHint: 'MQTT5 Payload Format Indicator：0=バイト列、1=UTF-8。未設定ならプロパティは送信されません',
    payloadFormatUnset: 'PFI · 未設定',
    topicAliasLabel: 'トピックエイリアス',
    topicAliasHint: 'MQTT5 のトピックエイリアスは接続単位で、CONNACK でブローカーが通告する topic-alias-maximum が上限です。超過は接続断ではなくエラーで拒否されます',
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
    subRejectedChip: '拒否: {reason}',
    subQuarantinedHint: '再購読するまで再試行しません（拒否された SUBACK はセッションを切断します）',
    capQosCeiling: 'ブローカーは QoS {n} まで',
    capRetainOff: 'このブローカーは retain 不可 (retain-available = 0)',
    capSharedOff: 'このブローカーは共有サブスクリプション未対応',
    capWildcardOff: 'このブローカーはワイルドカード購読未対応',
    capAliasMax: 'トピックエイリアス上限 {n}',
    capPacketSize: 'パケット上限 {n} B',
    capReceiveMax: '受信上限 {n}',
    capSessionExpiry: 'セッション有効期限 {n} 秒',
    capServerKeepAlive: 'サーバー keep-alive {n} 秒',
    capAssignedClientId: 'サーバー割当の clientId',
    capResponseInfo: '応答情報',
    capServerRef: 'サーバー参照',
    opsBrokerCapabilities: 'ブローカーが通告した機能',
    capAnnouncedAfterConnect: '接続後に CONNACK が通告',
    capAvailable: '対応',
    capUnavailable: '非対応',
    capRowWildcard: 'ワイルドカード',
    capRowAlias: 'トピックエイリアス',
    capRowReceive: '受信上限',
    capRowPacket: 'パケットサイズ',
    subRejectedToast: 'ブローカーが {topic} を拒否しました: {reason}',
    subDowngradedToast: 'ブローカーが {topic} を QoS {qos} に下げました',
    unsubRejectedToast: 'ブローカーが {topic} の解除を拒否しました: {reason} — 配信が続く可能性があります',
    clearRetainFailed: 'retained メッセージの消去に失敗',
    clearMessagesConfirm: 'もう一度クリックでこの一覧を消去',
    unsubscribeFailed: '{topic} の解除に失敗',
    subscribeFailed: '{topic} の購読に失敗',
    connectFailed: '接続に失敗',
    updateCheckFailed: '更新確認に失敗',
    subShareGroupRequired: '先に共有グループ名を入力してください',
    publishRejectedToast: 'ブローカーが publish を拒否しました: {reason}',
    publishRejectedManyToast: 'ブローカーが {n} 件の publish を拒否しました: {reason}',
    opsRejectedSubs: '拒否された購読',
    opsRefusedUnsubs: '拒否された解除',
    opsPublishRejected: '拒否された送信',
    opsAcksUnattributed: '対応できない応答コード',
    opsFeedFlushMs: 'フィードフラッシュ 平均/最大 (ms)',
    opsFeedLagMs: 'フラッチ遅延 平均/最大 (ms)',
    opsHistoryWriteMs: '履歴書き込み 平均/最大 (ms)',
    opsCalls: '回',
    opsLagHint: '100 ms 周期に対して',
    cmpTopic: 'トピック',
    cmpDirection: '方向',
    cmpUserProps: 'ユーザー属性',
    cmpPayload: 'ペイロード',
    compareToggle: '比較',
    comparePickTwo: '2 件のメッセージを選ぶと比較できます',
    compareTooLarge: 'ペイロードが大きすぎて行単位で対応付けできません — 両方そのまま表示',
    benchNoSubscribers: '購読者なし',
    corrHexHint: '相関データを生のバイト列の16進で表示',
    matchedByBrokerHint: 'ブローカーが購読識別子で返した一致サブスクライブ',
    matchedByLocalHint: 'ローカルで一致判定しました（ブローカーは識別子を返していません）',
    corrHexBadge: '16進',
    rpcNoCorrelation: '応答に相関データなし',
    ackCodeGrantedQos: 'QoS {qos} を許可',
    ackCodeUnspecified: '原因不明のエラー',
    ackCodeImplSpecific: 'サーバー実装固有のエラー',
    ackCodeNotAuthorized: '認可されていません (ACL)',
    ackCodeTopicFilterInvalid: 'トピックフィルタが不正',
    ackCodeTopicNameInvalid: 'トピック名が不正',
    ackCodePkidInUse: 'パケット ID が使用中',
    ackCodePkidNotFound: 'PACKET ID が見つかりません',
    ackCodeQuotaExceeded: 'quota を超過',
    ackCodeSharedSubsUnsupported: '共有サブスクリプション未対応',
    ackCodeSubIdUnsupported: 'サブスクリプション ID 未対応',
    ackCodeWildcardSubsUnsupported: 'ワイルドカード購読未対応',
    ackCodeNoSubscribers: '一致する購読者がいません',
    ackCodePayloadFormatInvalid: 'ペイロード形式が不正',
    ackCodeNoSubscriptionExisted: '該当する購読がありません',
    ackCodeUnrecognized: '不明な応答コード {code}',
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
    schedulesTitle: '定期 Publish',
    scheduleNote: 'バックエンドでスケジュール：ワークスペース切替・パネルを閉じる・ウィンドウ更新でも継続し、切断時は停止します。',
    scheduleUnsupported: 'CBOR ペイロードは定期発行できません。手動で発行してください。',
    scheduleEmpty: '定期タスクはありません',
    scheduleStopAll: 'すべて停止',
    scheduleRunNow: '実行中',
    scheduleRunDone: '完了',
    scheduleRunFailed: '失敗',
    scheduleRunStopped: '停止',
    rpcTitle: 'リクエスト / 応答',
    rpcAwaitReply: '応答を待機',
    rpcTimeoutLabel: 'タイムアウト (ms)',
    rpcHint: 'リクエストは応答トピックと相関データを持ちます。応答は相関データで、無い場合は送信順に対応付けられます',
    rpcPending: '待機中',
    rpcResolved: '応答済み',
    rpcNoReply: '応答なし',
    rpcRoundTrip: '往復',
    rpcResponseTopicPh: '空欄で自動生成',
    rpcPairedByPosition: '順序で対応付け（応答に相関データなし）',
    rpcCorrelationLabel: '相関データ',
    rpcReplyBody: '応答内容',
    rpcClear: '完了をクリア',
    rpcEmpty: 'リクエストはまだありません。「応答を待機」を ON にして公開すると作成されます',
    opsRpcPending: '待機中のリクエスト',
    opsRpcTimeouts: '応答なしのリクエスト',
    uiWorkspaceMode: 'ワークスペース',
    modeSubTransfer: '分割転送',
    modeSubConsole: '公開 / 購読',
    modeSubBridge: 'Broker ↔ Broker / HTTP',
    btnTemplate: 'テンプレート',
    btnPrettify: '整形',
    publishingNow: '送信中…',
    payloadTruncatedTip: 'コンソールは先頭のみ表示します。行を開くと全文を確認できます',
    clickToExpand: '⋯ クリックで展開',
    copyBtn: 'コピー',
    copiedBtn: 'コピーしました ✓',
    chunkHintIot: '(IoT / 低速回線)',
    chunkHintRecommended: '(推奨)',
    chunkHintFast: '(高速)',
    chunkHintLan: '(LAN)',
    chunkHintMax: '(最大)',
    brokerUserPh: 'ユーザー / Token',
    subscribeFailedAtConnect: '{count} 件の購読の登録に失敗しました：{detail}',
    batchSummaryAll: '{count} 件の送信と対端確認が完了しました',
    batchSummaryPartial: '{delivered} 件完了、{other} 件は未確認または失敗',
    trafficFilterPh: 'テーマを絞り込み',
    deleteConfirmAgain: 'もう一度クリックで削除確定',
    testRunning: '試行中…',
  },
};

/**
 * Translations for hooks that must report a problem themselves and have no
 * `t` prop (they are not React components). Reads the same persisted language
 * the app writes, so a toast never comes out in the wrong language.
 */
export const currentTranslations = (): Translations => {
  if (typeof localStorage === 'undefined') return translations['zh-CN'];
  const raw = localStorage.getItem('dropqtt_lang');
  const lang = (raw === 'en' || raw === 'zh-TW' || raw === 'ja' || raw === 'zh-CN') ? raw : 'zh-CN';
  return translations[lang] ?? translations['zh-CN'];
};
