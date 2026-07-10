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
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  wx: {
    appId: process.env.WX_APPID,
    secret: process.env.WX_SECRET,
    // Mock 模式：WX_MOCK=true 时不请求微信，openid = mock_<code hash>
    mock: process.env.WX_MOCK === 'true',
  },
  fastgpt: {
    baseUrl: process.env.FASTGPT_BASE_URL,
    appKey: process.env.FASTGPT_APP_KEY,
    openApiKey: process.env.FASTGPT_OPENAPI_KEY,
    // Mock 模式：FASTGPT_MOCK=true 时不调外部 FastGPT，按固定军师风格吐假流（供联调/测试）
    mock: process.env.FASTGPT_MOCK === 'true',
  },
});
