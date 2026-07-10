import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { ReportModule } from './modules/report/report.module';
import { TaskModule } from './modules/task/task.module';
import { StreakModule } from './modules/streak/streak.module';
import { SafetyModule } from './modules/safety/safety.module';

@Module({
  imports: [
    // 全局配置：读取 .env，Joi 校验，configuration() 结构化
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    // 业务模块骨架（M1+ 逐步实现）
    AuthModule,
    ChatModule,
    ReportModule,
    TaskModule,
    StreakModule,
    SafetyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
