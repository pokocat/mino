import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from './admin-auth.guard';

/**
 * 后台管理模块：单账号登录（env 注入）+ 设置编辑 + 仪表盘统计。
 * 复用与 AuthModule 同源的 jwt.secret 注册 JwtModule，但签发/校验的是 role='admin' 的令牌，
 * 与普通用户 JWT 相互独立（后台守卫只认 role==='admin'）。
 */
@Module({
  imports: [
    SettingsModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthGuard],
})
export class AdminModule {}
