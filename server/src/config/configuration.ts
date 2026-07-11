/**
 * 集中式配置读取。ConfigModule 通过 `load: [configuration]` 注入，
 * 业务侧用 `configService.get('fastgpt.baseUrl')` 之类的路径访问。
 */
export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  queue: {
    // 队列开关：显式 QUEUE_ENABLED=false 或无 REDIS_URL 时关闭（记忆旁路降级，主链路不受影响）
    enabled: process.env.QUEUE_ENABLED !== 'false' && !!process.env.REDIS_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  // 后台管理员单账号（env 注入）；任一为空即视为未配置，禁用后台登录。
  admin: {
    user: process.env.ADMIN_USER ?? '',
    pass: process.env.ADMIN_PASS ?? '',
  },
  wx: {
    appId: process.env.WX_APPID,
    secret: process.env.WX_SECRET,
    // Mock 模式：WX_MOCK=true 时不请求微信（登录 openid = mock_<code hash>；订阅消息仅打印 [mock push]）
    mock: process.env.WX_MOCK === 'true',
    // 订阅消息模板 id（占位；产品方在微信后台申请后填入）
    tmplDailyQ: process.env.WX_TMPL_DAILY_Q ?? '',
    tmplReportReady: process.env.WX_TMPL_REPORT_READY ?? '',
    // 订阅消息点击后跳转的小程序页面（可留空）
    pushPageChat: process.env.WX_PUSH_PAGE_CHAT ?? 'pages/chat/chat',
    pushPageReports: process.env.WX_PUSH_PAGE_REPORTS ?? 'pages/reports/list',
  },
  safety: {
    // 内容安全审核失败策略：默认 fail-open（放行），置 true 切严格模式（审核不可用即拦截）
    failClosed: process.env.SAFETY_FAIL_CLOSED === 'true',
  },
  fastgpt: {
    baseUrl: process.env.FASTGPT_BASE_URL,
    appKey: process.env.FASTGPT_APP_KEY,
    openApiKey: process.env.FASTGPT_OPENAPI_KEY,
    // Mock 模式：FASTGPT_MOCK=true 时不调外部 FastGPT，按固定军师风格吐假流（供联调/测试）
    mock: process.env.FASTGPT_MOCK === 'true',
    // 每用户知识库建库所需模型名（须与产品方 FastGPT config.json 中登记的模型一致）
    kbVectorModel:
      process.env.FASTGPT_KB_VECTOR_MODEL ?? 'text-embedding-3-small',
    kbAgentModel: process.env.FASTGPT_KB_AGENT_MODEL ?? 'gpt-4o-mini',
  },
  llm: {
    // 供应商：fastgpt（默认，走自托管 FastGPT 应用）| openai（直连 OpenAI 兼容端点）
    provider: process.env.LLM_PROVIDER ?? 'fastgpt',
    baseUrl: process.env.LLM_BASE_URL ?? '',
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
  },
});
