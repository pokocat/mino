import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

/**
 * 报告模块（M4 · 唯一交付物）：异步生成（BullMQ report-generate + Redis 不可用同步降级）、
 * CRUD、已读/计数、「跟军师聊这份报告」回流。ReportService 供 ChatService（军师主动触发）注入。
 */
@Module({
  imports: [QueueModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
