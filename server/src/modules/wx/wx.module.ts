import { Module } from '@nestjs/common';
import { WxAccessTokenService } from './wx-access-token.service';

/**
 * 微信基础能力模块：access_token 共享服务。
 * WxAccessTokenService 供 PushModule（订阅消息）与 SafetyModule（内容安全 msgSecCheck）共用。
 */
@Module({
  providers: [WxAccessTokenService],
  exports: [WxAccessTokenService],
})
export class WxModule {}
