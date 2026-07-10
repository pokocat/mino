import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { parseRedisUrl } from './kb-ingest.types';
import { ReportGenerateProcessor } from './report-generate.processor';
import {
  REPORT_GENERATE_QUEUE,
  ReportGenerateJobData,
} from './report-generate.types';

/**
 * report-generate 队列消费者（BullMQ Worker）。
 * 处理委托 ReportGenerateProcessor（其内部自消化异常并把报告置最终态）。
 * Redis 缺席时不启动 Worker——此时入队方已降级为同步执行，功能不受影响。
 */
@Injectable()
export class ReportGenerateWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportGenerateWorker.name);
  private worker?: Worker<ReportGenerateJobData>;
  private warned = false;

  constructor(
    private readonly config: ConfigService,
    private readonly processor: ReportGenerateProcessor,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('queue.enabled');
    const url = this.config.get<string>('redis.url');
    if (!enabled || !url) {
      this.logger.warn(
        'report-generate Worker 未启动（无 REDIS_URL 或已显式关闭）',
      );
      return;
    }
    try {
      this.worker = new Worker<ReportGenerateJobData>(
        REPORT_GENERATE_QUEUE,
        async (job: Job<ReportGenerateJobData>) =>
          this.processor.process(job.data),
        { connection: parseRedisUrl(url) },
      );
      this.worker.on('error', (err) => this.warnOnce(err));
      this.worker.on('failed', (job, err) => {
        this.logger.warn(`report-generate job ${job?.id} 失败：${String(err)}`);
      });
      this.logger.log('report-generate Worker 已启动');
    } catch (err) {
      this.logger.warn(`report-generate Worker 启动失败：${String(err)}`);
    }
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(`report-generate Worker 连接异常：${String(err)}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
