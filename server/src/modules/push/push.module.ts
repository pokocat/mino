import { Module } from '@nestjs/common';
import { WxPushService } from './wx-push.service';

/**
 * 推送模块（M5 · R4）：微信订阅消息发送（今日一问 / 报告完成）。
 * WxPushService 供 TaskModule（cron 派发后推送）与 QueueModule（报告 ready 后推送）注入。
 */
@Module({
  providers: [WxPushService],
  exports: [WxPushService],
})
export class PushModule {}
