import { Module } from '@nestjs/common';
import { FastgptModule } from '../fastgpt/fastgpt.module';
import { KbIngestProcessor } from './kb-ingest.processor';
import { KbIngestQueue } from './kb-ingest.queue';
import { KbIngestWorker } from './kb-ingest.worker';

/**
 * 队列模块（M3）：BullMQ + ioredis 承载 kb.ingest（对话要点写入用户知识库）。
 *
 * 容错原则（方案 R9）：Redis 不可达时整个队列层降级为空操作，应用照常启动、对话不受影响。
 * KbIngestQueue 供业务侧入队；KbIngestWorker 常驻消费；KbIngestProcessor 承载处理逻辑（可单测）。
 */
@Module({
  imports: [FastgptModule],
  providers: [KbIngestQueue, KbIngestWorker, KbIngestProcessor],
  exports: [KbIngestQueue],
})
export class QueueModule {}
