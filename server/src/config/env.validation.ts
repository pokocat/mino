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

  JWT_SECRET: Joi.string().min(1),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  WX_APPID: Joi.string().allow('').default(''),
  WX_SECRET: Joi.string().allow('').default(''),
  // Mock 登录开关（本地/联调无真实 appid 时置 true）
  WX_MOCK: Joi.boolean().truthy('true').falsy('false').default(false),

  FASTGPT_BASE_URL: Joi.string().uri().allow('').default(''),
  FASTGPT_APP_KEY: Joi.string().allow('').default(''),
  FASTGPT_OPENAPI_KEY: Joi.string().allow('').default(''),
})
  // 测试环境放宽：允许仅提供部分变量
  .options({ allowUnknown: true, abortEarly: false });
