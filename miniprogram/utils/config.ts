// 运行时配置（单一来源）：后端地址 / 字体 / 开发开关
// 生产构建时可由脚本注入覆盖；此处为接入端点默认值。
//
// ★ 后端接入端点（单一配置来源，迁移时只改这一处）：
//   线上：https://wxapi.aibuzz.cn/api_mino  （当前临时复用 junshi 所在服务器，
//         nginx 把 /api_mino/ 前缀剥离后转发到 mino 后端 127.0.0.1:4100）
//   本地：http://localhost:3000            （npm run start:dev 时用）
// 注意：真机/体验版需在微信公众平台「开发管理→服务器域名」把 request 与
//       上传下载域名加入 https://wxapi.aibuzz.cn（该域名已被 junshi 使用，多数情况已在白名单）。

// MOCK_API 开关：为 true 时 request 不发真实请求，返回内置 mock 数据，
// 保证无后端也能在开发者工具走通「登录→入局→chat 空态」全流程（M1 验收用）。
// 接入真实后端联调时置 false。
export const MOCK_API = false;

export const config = {
  // 后端接入端点。切回本地开发改成 'http://localhost:3000'。
  baseUrl: 'https://wxapi.aibuzz.cn/api_mino',
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
  // 我的页宫格点击 → 报告库预置类型筛选；reports/list onShow 消费后清除
  reportsPresetType: 'mn_reports_preset_type',
};
