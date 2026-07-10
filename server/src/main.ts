import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  // CORS 关闭：小程序请求不受浏览器同源策略约束，无需开放 CORS。
  const app = await NestFactory.create(AppModule, { cors: false });
  const configService = app.get(ConfigService);

  // 全局校验管道：DTO（class-validator）自动校验 + 剥离多余字段。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // 全局异常过滤器（统一 {code, message}）与请求日志拦截器。
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = configService.get<number>('port') ?? 3000;
  await app.listen(port);
  Logger.log(`米诺 V3 后端已启动：http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
