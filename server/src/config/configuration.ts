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
  },
  fastgpt: {
    baseUrl: process.env.FASTGPT_BASE_URL,
    appKey: process.env.FASTGPT_APP_KEY,
    openApiKey: process.env.FASTGPT_OPENAPI_KEY,
  },
});
