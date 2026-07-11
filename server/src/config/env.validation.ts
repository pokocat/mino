import * as Joi from 'joi';

/**
 * 环境变量校验 schema（@nestjs/config 启动时校验）。
 * 缺失或非法的关键变量会让应用在启动阶段即失败（fail-fast）。
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }),
  // 队列开关：置 false 可显式关闭 kb.ingest 队列（无 REDIS_URL 时自动降级）
  QUEUE_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),

  JWT_SECRET: Joi.string().min(1),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  WX_APPID: Joi.string().allow('').default(''),
  WX_SECRET: Joi.string().allow('').default(''),
  // Mock 登录开关（本地/联调无真实 appid 时置 true）
  WX_MOCK: Joi.boolean().truthy('true').falsy('false').default(false),
  // 订阅消息模板 id（占位，产品方申请后填入）与跳转页
  WX_TMPL_DAILY_Q: Joi.string().allow('').default(''),
  WX_TMPL_REPORT_READY: Joi.string().allow('').default(''),
  WX_PUSH_PAGE_CHAT: Joi.string().allow('').default('pages/chat/chat'),
  WX_PUSH_PAGE_REPORTS: Joi.string().allow('').default('pages/reports/list'),

  // 内容安全审核失败策略：默认 false（fail-open 放行），true 切严格模式（fail-closed）
  SAFETY_FAIL_CLOSED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),

  FASTGPT_BASE_URL: Joi.string().uri().allow('').default(''),
  FASTGPT_APP_KEY: Joi.string().allow('').default(''),
  FASTGPT_OPENAPI_KEY: Joi.string().allow('').default(''),
  // FastGPT Mock 开关（本地/联调/CI 无真实 FastGPT 时置 true）
  FASTGPT_MOCK: Joi.boolean().truthy('true').falsy('false').default(false),
  // 每用户知识库建库所需模型名（须与产品方 FastGPT 配置一致）
  FASTGPT_KB_VECTOR_MODEL: Joi.string()
    .allow('')
    .default('text-embedding-3-small'),
  FASTGPT_KB_AGENT_MODEL: Joi.string().allow('').default('gpt-4o-mini'),
  // LLM 供应商切换：openai 时直连 OpenAI 兼容端点（LLM_BASE_URL 形如 https://host/v1）
  LLM_PROVIDER: Joi.string().valid('fastgpt', 'openai').default('fastgpt'),
  LLM_BASE_URL: Joi.string().uri().allow('').default(''),
  LLM_API_KEY: Joi.string().allow('').default(''),
  LLM_MODEL: Joi.string().allow('').default(''),
})
  // 测试环境放宽：允许仅提供部分变量
  .options({ allowUnknown: true, abortEarly: false });
