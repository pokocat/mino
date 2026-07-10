// 运行时配置（单一来源）：后端地址 / 字体 / 开发开关
// 生产构建时可由脚本注入覆盖；此处为 dev 默认值。

// MOCK_API 开关：为 true 时 request 不发真实请求，返回内置 mock 数据，
// 保证无后端也能在开发者工具走通「登录→入局→chat 空态」全流程（M1 验收用）。
export const MOCK_API = true;

export const config = {
  // dev 后端地址（NestJS 代理）。真机需替换为 request 合法域名。
  baseUrl: 'http://localhost:3000',
  // 子集化衬线字体 CDN 占位（R3 第一步）：留空则直接降级系统衬线栈，不加载。
  serifFontUrl: '',
  // 与 tokens.wxss --font-serif 首选族名保持一致。
  serifFontFamily: 'Noto Serif SC',
  // 订阅消息模板 id（R4）：审核通过后填入「今日一问」「报告写好了」模板 id。
  // 留空数组时 utils/subscribe 直接跳过、不调 wx.requestSubscribeMessage。
  subscribeTmplIds: [] as string[],
};

// 本地存储键位
export const STORAGE_KEYS = {
  token: 'mn_token',
  // 报告详情「跟军师聊/补充」→ 暂存目标会话 id，chat 页 onShow 检查并续该会话
  pendingConversationId: 'mn_pending_conversation_id',
  // 订阅消息授权：每场景每日最多请求一次，键为 前缀+场景，值记请求日期（YYYY-MM-DD）
  subscribeDatePrefix: 'mn_subscribe_',
};
