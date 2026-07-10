import { Module } from '@nestjs/common';
import { WxModule } from '../wx/wx.module';
import { WxPushService } from './wx-push.service';

/**
 * 推送模块（M5 · R4）：微信订阅消息发送（今日一问 / 报告完成）。
 * WxPushService 供 TaskModule（cron 派发后推送）与 QueueModule（报告 ready 后推送）注入。
 * access_token 换取复用 WxModule 的 WxAccessTokenService（与内容安全模块共享）。
 */
@Module({
  imports: [WxModule],
  providers: [WxPushService],
  exports: [WxPushService],
})
export class PushModule {}
