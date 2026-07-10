import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MeController } from './me.controller';
import { WxApiService } from './wx-api.service';

/** 鉴权模块：微信 code2session → JWT、入局 profile、/me 聚合。 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('jwt.secret'),
        // expiresIn 取字符串（如 '7d'）；@nestjs/jwt 类型为 ms 模板字面量，此处显式收窄
        signOptions: {
          expiresIn: (config.get<string>('jwt.expiresIn') ??
            '7d') as `${number}d`,
        },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, WxApiService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
