import { Module } from '@nestjs/common';
import { FastgptModule } from '../fastgpt/fastgpt.module';
import { PushModule } from '../push/push.module';
import { KbIngestProcessor } from './kb-ingest.processor';
import { KbIngestQueue } from './kb-ingest.queue';
import { KbIngestWorker } from './kb-ingest.worker';
import { ReportGenerateProcessor } from './report-generate.processor';
import { ReportGenerateQueue } from './report-generate.queue';
import { ReportGenerateWorker } from './report-generate.worker';

/**
 * 队列模块（M3 kb.ingest + M4 report-generate）：BullMQ + ioredis。
 *
 * 容错原则（方案 R9）：Redis 不可达时——
 *  - kb.ingest（记忆旁路）整体降级为空操作；
 *  - report-generate（唯一交付物）入队返回 false，由业务侧降级为同步执行，保证功能可用。
 * 两者的 Queue 供业务侧入队，Worker 常驻消费，Processor 承载可单测的处理逻辑。
 */
@Module({
  imports: [FastgptModule, PushModule],
  providers: [
    KbIngestQueue,
    KbIngestWorker,
    KbIngestProcessor,
    ReportGenerateQueue,
    ReportGenerateWorker,
    ReportGenerateProcessor,
  ],
  exports: [KbIngestQueue, ReportGenerateQueue, ReportGenerateProcessor],
})
export class QueueModule {}
