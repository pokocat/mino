import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { KbIngestProcessor } from './kb-ingest.processor';
import {
  KB_INGEST_QUEUE,
  KbIngestJobData,
  parseRedisUrl,
} from './kb-ingest.types';

/**
 * kb.ingest 队列消费者（BullMQ Worker）。
 *
 * 与主链路隔离：Worker 连接异常只告警，不影响应用其余部分。
 * job 处理委托给 KbIngestProcessor（可单测）；处理抛错交由 BullMQ 按 attempts 上限重试。
 */
@Injectable()
export class KbIngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KbIngestWorker.name);
  private worker?: Worker<KbIngestJobData>;
  private warned = false;

  constructor(
    private readonly config: ConfigService,
    private readonly processor: KbIngestProcessor,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('queue.enabled');
    const url = this.config.get<string>('redis.url');
    if (!enabled || !url) {
      this.logger.warn('kb.ingest Worker 未启动（无 REDIS_URL 或已显式关闭）');
      return;
    }
    try {
      this.worker = new Worker<KbIngestJobData>(
        KB_INGEST_QUEUE,
        async (job: Job<KbIngestJobData>) => this.processor.process(job.data),
        { connection: parseRedisUrl(url) },
      );
      this.worker.on('error', (err) => this.warnOnce(err));
      this.worker.on('failed', (job, err) => {
        this.logger.warn(
          `kb.ingest job ${job?.id} 失败（第 ${job?.attemptsMade} 次）：${String(err)}`,
        );
      });
      this.logger.log('kb.ingest Worker 已启动');
    } catch (err) {
      this.logger.warn(
        `kb.ingest Worker 启动失败，记忆写入将不消费：${String(err)}`,
      );
    }
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(`kb.ingest Worker 连接异常：${String(err)}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
