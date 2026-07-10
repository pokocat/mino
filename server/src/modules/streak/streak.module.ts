import { Module } from '@nestjs/common';
import { StreakService } from './streak.service';

/**
 * 连续天数模块（M5 · R6）：Asia/Shanghai 日界结算 streak。
 * StreakService 供 ChatService（发消息入口旁路结算）注入；日界计算见 streak.util.ts 纯函数。
 */
@Module({
  providers: [StreakService],
  exports: [StreakService],
})
export class StreakModule {}
