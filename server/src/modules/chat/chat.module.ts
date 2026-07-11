import { Module } from '@nestjs/common';
import { FastgptModule } from '../fastgpt/fastgpt.module';
import { QueueModule } from '../queue/queue.module';
import { ReportModule } from '../report/report.module';
import { SafetyModule } from '../safety/safety.module';
import { StreakModule } from '../streak/streak.module';
import { SettingsModule } from '../settings/settings.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * 对话模块（M2 + M3 + M4 + M5）：建会话、SSE 流式对话、report_ready 标记拦截、suggestions 注入；
 * M3 增：流前检索用户知识库拼装上下文、流后异步入队 kb.ingest；
 * M4 增：米诺主动触发（reportOffer 时经 ReportService 建 origin=agent 报告）、报告回流会话首轮上下文注入；
 * M5 增：发消息入口旁路结算 streak（StreakService）。
 * M6 增：发消息入口审用户输入、流后审 assistant 全文（WxSecService · R7）。
 */
@Module({
  imports: [
    FastgptModule,
    QueueModule,
    ReportModule,
    StreakModule,
    SafetyModule,
    SettingsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
